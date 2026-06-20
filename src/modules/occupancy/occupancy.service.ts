import { createHmac, timingSafeEqual } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/database/supabase.provider';
import { ValidateQrDto } from './dto/validate-qr.dto';

const QR_VALIDITY_SECONDS = 10;

type QrTokenPayload = {
  uid: string;
  iat: number; // Unix seconds
};

type ValidationResult =
  | { success: true; userId: string; eventType: 'entry' | 'exit' }
  | { success: false; reason: 'invalid_format' | 'invalid_signature' | 'expired_qr' | 'inactive_user' | 'internal_error' };

@Injectable()
export class OccupancyService {
  private readonly logger = new Logger(OccupancyService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async validateQr(dto: ValidateQrDto): Promise<ValidationResult> {
    const secret = process.env.HMAC_QR_SECRET;
    if (!secret) {
      this.logger.error('HMAC_QR_SECRET is not configured');
      return { success: false, reason: 'internal_error' };
    }

    // Step 1: Parse token format <base64url_payload>.<base64url_signature>
    const parts = dto.qr_hash.split('.');
    if (parts.length !== 2) {
      return { success: false, reason: 'invalid_format' };
    }
    const [encodedPayload, receivedSignature] = parts;

    // Step 2: Verify HMAC signature using timing-safe comparison
    const expectedSignature = createHmac('sha256', secret)
      .update(encodedPayload)
      .digest('base64url');

    const signaturesMatch = timingSafeEqual(
      Buffer.from(receivedSignature, 'base64url'),
      Buffer.from(expectedSignature, 'base64url'),
    );

    if (!signaturesMatch) {
      return { success: false, reason: 'invalid_signature' };
    }

    // Step 3: Decode payload and verify timestamp window
    let payload: QrTokenPayload;
    try {
      const json = Buffer.from(encodedPayload, 'base64url').toString('utf8');
      payload = JSON.parse(json) as QrTokenPayload;
    } catch {
      return { success: false, reason: 'invalid_format' };
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const ageSeconds = nowSeconds - payload.iat;

    if (ageSeconds < 0 || ageSeconds > QR_VALIDITY_SECONDS) {
      return { success: false, reason: 'expired_qr' };
    }

    // Step 4: Check user status in Supabase (service_role bypasses RLS)
    const { data: userRow, error } = await this.supabase
      .from('users')
      .select('status')
      .eq('id', payload.uid)
      .single();

    if (error || !userRow) {
      this.logger.warn(`User lookup failed for uid=${payload.uid}: ${error?.message}`);
      return { success: false, reason: 'inactive_user' };
    }

    if (userRow.status !== 'active') {
      return { success: false, reason: 'inactive_user' };
    }

    // Step 5: Insert occupancy log (async cloud sync from edge)
    // TODO(multi-tenant): ValidateQrDto should carry gym_id from the local edge device
    // so logs are scoped to the correct branch. For now gym_id is null.
    const { error: insertError } = await this.supabase
      .from('occupancy_logs')
      .insert({
        user_id: payload.uid,
        gym_id: null, // TODO: populate from dto.gym_id once edge service sends it
        event_type: dto.event_type,
        qr_hash: dto.qr_hash,
        validated_at: new Date().toISOString(),
      });

    if (insertError) {
      this.logger.error(`Failed to insert occupancy log: ${insertError.message}`);
      return { success: false, reason: 'internal_error' };
    }

    return {
      success: true,
      userId: payload.uid,
      eventType: dto.event_type,
    };
  }
}

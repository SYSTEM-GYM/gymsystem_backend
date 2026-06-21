import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/database/supabase.provider';
import { ValidateQrDto } from './dto/validate-qr.dto';
import { verifyQrToken, isUuidV4 } from '../../shared/utils/qr-token.util';
import { checkGymAccessHours } from '../../shared/utils/gym-hours.util';

export type QrGranted = { granted: true; member_name: string };
export type QrDenied = { granted: false; reason: string };
export type QrResult = QrGranted | QrDenied;

type UserRow = {
  id: string;
  first_name: string | null;
  full_name: string | null;
  status: string;
  home_gym_id: string | null;
  global_access: boolean;
};

@Injectable()
export class OccupancyService {
  private readonly logger = new Logger(OccupancyService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  private resolveUserId(qrCode: string): { userId: string } | { reason: string } {
    const secret = process.env.HMAC_QR_SECRET;

    if (qrCode.includes('.')) {
      if (!secret) {
        this.logger.error('HMAC_QR_SECRET not configured');
        return { reason: 'Serviço de acesso indisponível' };
      }
      const verified = verifyQrToken(qrCode, secret);
      if (!verified.ok) return { reason: verified.reason };
      return { userId: verified.userId };
    }

    if (isUuidV4(qrCode)) {
      this.logger.warn('Legacy raw UUID QR scanned — upgrade edge client to HMAC tokens');
      return { userId: qrCode };
    }

    return { reason: 'Token QR inválido' };
  }

  private async logAccessAttempt(
    userId: string | null,
    gymId: string,
    granted: boolean,
    reason: string,
  ): Promise<void> {
    const { error } = await this.supabase.from('audit_logs').insert({
      actor_id: userId,
      action: granted ? 'access_granted' : 'access_denied',
      resource_type: 'occupancy',
      resource_id: userId ?? gymId,
      metadata: { gym_id: gymId, reason, granted },
    });
    if (error) {
      this.logger.warn(`Failed to write access audit log: ${error.message}`);
    }
  }

  async validateQrCode(dto: ValidateQrDto): Promise<QrResult> {
    const { qr_code: qrCode, gym_id: gymId } = dto;

    const resolved = this.resolveUserId(qrCode);
    if ('reason' in resolved) {
      await this.logAccessAttempt(null, gymId, false, resolved.reason);
      return { granted: false, reason: resolved.reason };
    }

    const userId = resolved.userId;

    const { data: user, error: fetchError } = await this.supabase
      .from('users')
      .select('id, first_name, full_name, status, home_gym_id, global_access')
      .eq('id', userId)
      .single<UserRow>();

    if (fetchError || !user) {
      this.logger.warn(`QR validation — user not found: ${userId}`);
      await this.logAccessAttempt(userId, gymId, false, 'Usuário não encontrado');
      return { granted: false, reason: 'Usuário não encontrado' };
    }

    if (user.status !== 'active') {
      this.logger.warn(`QR validation — inactive user: ${userId} (status=${user.status})`);
      const statusReasons: Record<string, string> = {
        inactive: 'Plano Inativo / Inadimplente',
        banned: 'Acesso Bloqueado por Suspensão',
      };
      const reason = statusReasons[user.status] ?? 'Plano Inativo / Inadimplente';
      await this.logAccessAttempt(userId, gymId, false, reason);
      return { granted: false, reason };
    }

    const hasGymAccess = user.global_access || user.home_gym_id === gymId;
    if (!hasGymAccess) {
      this.logger.warn(
        `QR validation — wrong gym: userId=${userId} homeGym=${user.home_gym_id} requestedGym=${gymId}`,
      );
      const reason = 'Acesso restrito à filial de origem';
      await this.logAccessAttempt(userId, gymId, false, reason);
      return { granted: false, reason };
    }

    const now = new Date();
    const [{ data: hours }, { data: holidays }] = await Promise.all([
      this.supabase
        .from('gym_operating_hours')
        .select('day_of_week, open_time, close_time, is_closed')
        .eq('gym_id', gymId),
      this.supabase
        .from('gym_holidays')
        .select('date, is_closed')
        .eq('gym_id', gymId)
        .eq('date', now.toISOString().split('T')[0]),
    ]);

    const hoursReason = checkGymAccessHours(now, hours ?? [], holidays ?? []);
    if (hoursReason) {
      this.logger.warn(`QR validation — outside hours: userId=${userId} gym=${gymId}`);
      await this.logAccessAttempt(userId, gymId, false, hoursReason);
      return { granted: false, reason: hoursReason };
    }

    const { error: insertError } = await this.supabase.from('occupancy_logs').insert({
      user_id: userId,
      gym_id: gymId,
      entered_at: now.toISOString(),
    });

    if (insertError) {
      this.logger.error(
        `Failed to insert occupancy log for user ${userId}: ${insertError.message}`,
      );
    }

    const memberName = user.first_name ?? user.full_name?.split(' ')[0] ?? 'Membro';
    this.logger.log(`QR validation — GRANTED: ${memberName} (${userId}) at gym ${gymId}`);
    await this.logAccessAttempt(userId, gymId, true, 'Entrada autorizada');

    return { granted: true, member_name: memberName };
  }
}

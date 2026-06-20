import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/database/supabase.provider';
import { ValidateQrDto } from './dto/validate-qr.dto';

// ── Response types ────────────────────────────────────────────────────────────

export type QrGranted  = { granted: true;  member_name: string };
export type QrDenied   = { granted: false; reason: string };
export type QrResult   = QrGranted | QrDenied;

// ── User row shape returned by the DB query ───────────────────────────────────

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

  /**
   * Validates a QR code scanned by the Local Edge Service.
   *
   * MVP: qr_code is the raw user UUID. The upgrade path is to replace this
   * with a time-limited HMAC token signed server-side on the mobile app.
   *
   * Business rules (evaluated in order, fail fast):
   *   1. User must exist in public.users.
   *   2. User status must be 'active'.
   *   3. User's home_gym_id must equal gymId, OR global_access must be true.
   *
   * On success, an occupancy_log row is inserted and the response is returned
   * to the edge service so it can fire the turnstile TCP command.
   */
  async validateQrCode(dto: ValidateQrDto): Promise<QrResult> {
    const { qr_code: userId, gym_id: gymId } = dto;

    // ── Check 1: User exists ──────────────────────────────────────────────────
    const { data: user, error: fetchError } = await this.supabase
      .from('users')
      .select('id, first_name, full_name, status, home_gym_id, global_access')
      .eq('id', userId)
      .single<UserRow>();

    if (fetchError || !user) {
      this.logger.warn(`QR validation — user not found: ${userId}`);
      return { granted: false, reason: 'Usuário não encontrado' };
    }

    // ── Check 2: Active status ────────────────────────────────────────────────
    if (user.status !== 'active') {
      this.logger.warn(`QR validation — inactive user: ${userId} (status=${user.status})`);
      const statusReasons: Record<string, string> = {
        inactive: 'Plano Inativo / Inadimplente',
        banned:   'Acesso Bloqueado por Suspensão',
      };
      return {
        granted: false,
        reason: statusReasons[user.status] ?? 'Plano Inativo / Inadimplente',
      };
    }

    // ── Check 3: Multi-tenant gym access ──────────────────────────────────────
    const hasGymAccess = user.global_access || user.home_gym_id === gymId;
    if (!hasGymAccess) {
      this.logger.warn(
        `QR validation — wrong gym: userId=${userId} homeGym=${user.home_gym_id} requestedGym=${gymId}`,
      );
      return { granted: false, reason: 'Acesso restrito à filial de origem' };
    }

    // ── All checks passed: log the entry ──────────────────────────────────────
    const { error: insertError } = await this.supabase
      .from('occupancy_logs')
      .insert({
        user_id:      userId,
        gym_id:       gymId,
        entered_at:   new Date().toISOString(),
        // exited_at intentionally null — populated when the member leaves
      });

    if (insertError) {
      // Log the error but do NOT deny access — the member was validly authenticated.
      // A logging failure must never block a paying customer at the door.
      this.logger.error(`Failed to insert occupancy log for user ${userId}: ${insertError.message}`);
    }

    const memberName = user.first_name ?? user.full_name?.split(' ')[0] ?? 'Membro';

    this.logger.log(`QR validation — GRANTED: ${memberName} (${userId}) at gym ${gymId}`);

    return { granted: true, member_name: memberName };
  }
}

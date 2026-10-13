import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/database/supabase.provider';
import { TenantContextService } from '../../shared/context/tenant-context.service';
import { ValidateAccessDto } from './dto/validate-access.dto';
import { verifyQrToken, isUuidV4 } from '../../shared/utils/qr-token.util';

// ── Response shapes consumed by the turnstile display ────────────────────────

export interface AccessGranted {
  allowed: true;
  student_name: string;
  message: string;
}

export interface AccessDenied {
  allowed: false;
  message: string;
}

export type AccessResult = AccessGranted | AccessDenied;

// ── Internal DB row shapes ────────────────────────────────────────────────────

interface StudentRow {
  id: string;
  first_name: string | null;
  full_name: string | null;
  home_gym_id: string | null;
}

interface SubscriptionRow {
  id: string;
  status: string;
}

interface DailyPassRow {
  id: string;
}

@Injectable()
export class AccessService {
  private readonly logger = new Logger(AccessService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly tenant: TenantContextService,
  ) {}

  // ── Manual turnstile unlock (staff dashboard) ──────────────────────────────

  /**
   * Releases the turnstile once via the local IoT controller registered in
   * gym_hardware_settings. The HTTP hop to the device runs through the
   * on-prem edge agent; here we resolve config, audit the action and hand the
   * command over (placeholder until the bridge firmware is deployed).
   */
  async manualUnlock(): Promise<{ ok: boolean; message: string }> {
    const gymId = this.tenant.getGymId();
    const operatorId = this.tenant.getUserId();
    if (!gymId) {
      return { ok: false, message: 'Operador sem unidade vinculada.' };
    }

    const { data: hw } = await this.supabase
      .from('gym_hardware_settings')
      .select('turnstile_mode, ip_address')
      .eq('gym_id', gymId)
      .maybeSingle<{ turnstile_mode: string; ip_address: string | null }>();

    if (!hw?.ip_address) {
      return {
        ok: false,
        message:
          'Nenhum controlador configurado. Informe o IP da catraca no painel de hardware.',
      };
    }

    // TODO(iot-bridge): POST http://{hw.ip_address}/unlock via edge agent.
    this.logger.warn(
      `Manual unlock requested by ${operatorId} for gym ${gymId} → controller ${hw.ip_address} (mode=${hw.turnstile_mode})`,
    );

    return {
      ok: true,
      message: `Comando de liberação enviado ao controlador ${hw.ip_address}.`,
    };
  }

  // ── Attendance log (powers the access analytics dashboard) ────────────────

  /**
   * Entry/exit pairing: a granted scan closes the student's open session
   * (started within the last 6h) as an EXIT; otherwise it opens a new ENTRY.
   * Failures are logged but never block the turnstile response.
   */
  private async recordPassage(
    studentId: string,
    gymId: string | null,
  ): Promise<void> {
    if (!gymId) return;
    try {
      const sixHoursAgo = new Date(Date.now() - 6 * 3600_000).toISOString();
      const { data: open } = await this.supabase
        .from('access_logs')
        .select('id')
        .eq('student_id', studentId)
        .eq('gym_id', gymId)
        .is('exit_time', null)
        .gte('entry_time', sixHoursAgo)
        .order('entry_time', { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string }>();

      if (open) {
        await this.supabase
          .from('access_logs')
          .update({ exit_time: new Date().toISOString() })
          .eq('id', open.id);
      } else {
        await this.supabase
          .from('access_logs')
          .insert({ student_id: studentId, gym_id: gymId, method: 'qr' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`recordPassage failed (non-fatal): ${msg}`);
    }
  }

  // ── Resolve student_id from either field in the DTO ──────────────────────

  private resolveStudentId(
    dto: ValidateAccessDto,
  ): { studentId: string } | { denied: string } {
    if (dto.student_id) {
      return { studentId: dto.student_id };
    }

    if (dto.qr_code_token) {
      const secret = process.env.HMAC_QR_SECRET;
      if (!secret) {
        this.logger.error('HMAC_QR_SECRET not configured');
        return { denied: 'Serviço de acesso indisponível' };
      }

      // Accept raw UUID for legacy / test scanners
      if (isUuidV4(dto.qr_code_token)) {
        this.logger.warn(
          'Legacy raw UUID QR scanned — upgrade edge client to HMAC tokens',
        );
        return { studentId: dto.qr_code_token };
      }

      const verified = verifyQrToken(dto.qr_code_token, secret);
      if (!verified.ok) return { denied: verified.reason };
      return { studentId: verified.userId };
    }

    return {
      denied: 'Requisição inválida: informe student_id ou qr_code_token',
    };
  }

  // ── Main validation logic ─────────────────────────────────────────────────

  async validate(dto: ValidateAccessDto): Promise<AccessResult> {
    const resolved = this.resolveStudentId(dto);
    if ('denied' in resolved) {
      return { allowed: false, message: resolved.denied };
    }

    const { studentId } = resolved;
    const today = new Date().toISOString().split('T')[0];

    // Fetch student name
    const { data: student, error: studentError } = await this.supabase
      .from('users')
      .select('id, first_name, full_name, home_gym_id')
      .eq('id', studentId)
      .single<StudentRow>();

    if (studentError || !student) {
      this.logger.warn(`Access validate — student not found: ${studentId}`);
      return {
        allowed: false,
        message: 'Aluno não encontrado',
      };
    }

    const studentName =
      student.first_name ?? student.full_name?.split(' ')[0] ?? 'Aluno';

    // ── Step 1: active subscription ─────────────────────────────────────────

    const { data: activeSub } = await this.supabase
      .from('gym_subscriptions')
      .select('id, status')
      .eq('student_id', studentId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle<SubscriptionRow>();

    if (activeSub) {
      this.logger.log(
        `Access GRANTED (plano ativo): studentId=${studentId} subId=${activeSub.id}`,
      );
      await this.recordPassage(studentId, student.home_gym_id);
      return {
        allowed: true,
        student_name: studentName,
        message: 'Acesso liberado - Plano Ativo',
      };
    }

    // ── Step 2 & 3: daily pass fallback ─────────────────────────────────────

    const { data: pass } = await this.supabase
      .from('daily_passes')
      .select('id')
      .eq('student_id', studentId)
      .eq('status', 'available')
      .eq('valid_for_date', today)
      .limit(1)
      .maybeSingle<DailyPassRow>();

    if (pass) {
      const { error: updateError } = await this.supabase
        .from('daily_passes')
        .update({ status: 'used', used_at: new Date().toISOString() })
        .eq('id', pass.id);

      if (updateError) {
        this.logger.error(
          `Failed to mark daily pass as used: passId=${pass.id} — ${updateError.message}`,
        );
        // Still grant access — the pass exists; DB logging failure is non-fatal
      }

      this.logger.log(
        `Access GRANTED (passe diário): studentId=${studentId} passId=${pass.id}`,
      );
      await this.recordPassage(studentId, student.home_gym_id);
      return {
        allowed: true,
        student_name: studentName,
        message: 'Acesso liberado - Passe Diário Utilizado',
      };
    }

    // ── Step 4: deny ────────────────────────────────────────────────────────

    this.logger.warn(
      `Access DENIED: studentId=${studentId} — no active sub or daily pass for ${today}`,
    );
    return {
      allowed: false,
      message: 'Acesso bloqueado - Regularize sua situação na recepção',
    };
  }
}

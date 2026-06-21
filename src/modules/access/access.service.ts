import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/database/supabase.provider';
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
  ) {}

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

    return { denied: 'Requisição inválida: informe student_id ou qr_code_token' };
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
      .select('id, first_name, full_name')
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

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { AuthError, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/database/supabase.provider';
import { RegisterDto } from './dto/register.dto';

export interface RegisterResult {
  id: string;
  email: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Creates an already-confirmed account through the Supabase Admin API, so
   * sign-up never depends on SMTP delivery. The handle_new_user trigger
   * creates the public.users profile (role 'customer', default gym); this
   * method then fills in the extra profile fields.
   */
  async register(dto: RegisterDto): Promise<RegisterResult> {
    const email = dto.email.trim().toLowerCase();
    const fullName = dto.full_name.trim().replace(/\s+/g, ' ');
    const phone = dto.phone?.trim() || null;

    if (!fullName) {
      throw new BadRequestException('Informe seu nome completo.');
    }

    if (dto.gym_id) {
      await this.assertGymExists(dto.gym_id);
    }

    const { data, error } = await this.supabase.auth.admin.createUser({
      email,
      password: dto.password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (error || !data.user) {
      throw this.mapCreateUserError(error);
    }

    const userId = data.user.id;
    const [firstName, ...rest] = fullName.split(' ');

    const profile: Record<string, string | null> = {
      full_name: fullName,
      first_name: firstName,
      last_name: rest.join(' ') || null,
      phone,
      updated_at: new Date().toISOString(),
    };
    if (dto.gym_id) {
      profile.home_gym_id = dto.gym_id;
    }

    const { error: profileError } = await this.supabase
      .from('users')
      .update(profile)
      .eq('id', userId);

    if (profileError) {
      // Roll back so the e-mail stays free for a retry instead of leaving a
      // half-initialised account behind.
      this.logger.error(
        `register: profile update failed for ${userId}: ${profileError.message}`,
      );
      await this.supabase.auth.admin.deleteUser(userId).catch(() => undefined);
      throw new InternalServerErrorException(
        'Não foi possível concluir seu cadastro. Tente novamente.',
      );
    }

    this.logger.log(`register: account created ${userId}`);
    return { id: userId, email };
  }

  private async assertGymExists(gymId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('gyms')
      .select('id')
      .eq('id', gymId)
      .maybeSingle<{ id: string }>();

    if (error) {
      this.logger.error(`register: gym lookup failed: ${error.message}`);
      throw new InternalServerErrorException(
        'Não foi possível concluir seu cadastro. Tente novamente.',
      );
    }
    if (!data) {
      throw new BadRequestException('Unidade não encontrada.');
    }
  }

  private mapCreateUserError(error: AuthError | null): Error {
    const code = error?.code ?? '';
    const message = error?.message ?? '';

    if (
      code === 'email_exists' ||
      code === 'user_already_exists' ||
      /already (been )?registered/i.test(message)
    ) {
      return new ConflictException('Este e-mail já está cadastrado.');
    }
    if (code === 'weak_password') {
      return new BadRequestException(
        'Senha muito fraca. Use letras, números e pelo menos 8 caracteres.',
      );
    }
    if (code === 'email_address_invalid') {
      return new BadRequestException('Informe um e-mail válido.');
    }

    this.logger.error(
      `register: createUser failed (${code || error?.status}): ${message}`,
    );
    return new InternalServerErrorException(
      'Não foi possível criar sua conta. Tente novamente.',
    );
  }
}

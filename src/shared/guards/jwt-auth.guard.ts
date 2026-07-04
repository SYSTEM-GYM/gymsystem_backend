import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseClient, User } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../database/supabase.provider';
import { TenantContext } from '../context/tenant-context.types';
import { extractAppMetadata } from '../utils/jwt-claims.util';

export type AuthenticatedRequest = Request & {
  user?: User;
  tenant?: TenantContext;
};

/**
 * Validates the bearer token, then resolves { userId, role, gymId } and
 * attaches it to the request as `request.tenant`. TenantContextInterceptor
 * (registered globally) picks this up and scopes it via AsyncLocalStorage
 * for the rest of the request lifecycle — guards run before interceptors,
 * so this is where the tenant data must be produced.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }

    const token = authHeader.slice(7);
    const {
      data: { user },
      error,
    } = await this.supabase.auth.getUser(token);

    if (error || !user) {
      throw new UnauthorizedException();
    }

    request.user = user;
    request.tenant = await this.resolveTenant(user, token);
    return true;
  }

  /**
   * Reads role/gym_id from the JWT's app_metadata (populated by the
   * custom_access_token_hook). Falls back to a direct DB lookup for legacy
   * tokens issued/refreshed before the hook went live, so existing sessions
   * keep working with zero downtime during rollout.
   */
  private async resolveTenant(
    user: User,
    token: string,
  ): Promise<TenantContext> {
    const claims = extractAppMetadata(token);

    if (claims?.role) {
      return {
        userId: user.id,
        role: claims.role,
        gymId: claims.gym_id ?? null,
      };
    }

    this.logger.debug(
      `Token for user ${user.id} has no app_metadata claims yet — falling back to DB lookup.`,
    );

    const { data, error } = await this.supabase
      .from('users')
      .select('role, home_gym_id')
      .eq('id', user.id)
      .single();

    if (error || !data) {
      throw new UnauthorizedException(
        'Não foi possível resolver o perfil do usuário.',
      );
    }

    return {
      userId: user.id,
      role: data.role as string,
      gymId: (data.home_gym_id as string | null) ?? null,
    };
  }
}

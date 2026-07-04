import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * Pair as: @UseGuards(JwtAuthGuard, RolesGuard) @Roles('gym_admin', ...)
 *
 * Reads the role from `request.tenant` (set by JwtAuthGuard) rather than
 * TenantContextService: Nest runs all guards before any interceptor, so the
 * AsyncLocalStorage scope — established by TenantContextInterceptor — does
 * not exist yet at guard time. Application code outside guards should still
 * prefer TenantContextService.getRole() for the same value.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<
      string[] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.tenant?.role;

    if (!role) {
      throw new UnauthorizedException();
    }
    if (!requiredRoles.includes(role)) {
      throw new ForbiddenException('Permissão insuficiente para este recurso.');
    }

    return true;
  }
}

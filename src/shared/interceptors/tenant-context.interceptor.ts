import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContextService } from '../context/tenant-context.service';
import { AuthenticatedRequest } from '../guards/jwt-auth.guard';

/**
 * Establishes the AsyncLocalStorage scope for the request. Must run after
 * JwtAuthGuard (guards execute before interceptors in Nest's pipeline), which
 * is where `request.tenant` is populated. Registered globally in AppModule
 * so every route — guarded or not — passes through it; unguarded/public
 * routes simply proceed without a tenant scope.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const tenant = request.tenant;

    if (!tenant) {
      return next.handle();
    }

    return new Observable((subscriber) => {
      this.tenantContext.run(tenant, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}

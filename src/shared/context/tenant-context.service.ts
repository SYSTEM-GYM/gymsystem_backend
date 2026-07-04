import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { TenantContext } from './tenant-context.types';

/**
 * Request-scoped tenant data (userId/gymId/role), propagated via
 * AsyncLocalStorage so any service can read it without gym_id being
 * threaded through every method signature.
 *
 * Populated once per request by TenantContextInterceptor; never call
 * `run()` from application code outside that interceptor.
 */
@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantContext>();

  run<T>(context: TenantContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  getContext(): TenantContext | undefined {
    return this.storage.getStore();
  }

  getUserId(): string {
    return this.requireContext().userId;
  }

  getGymId(): string | null {
    return this.requireContext().gymId;
  }

  getRole(): string {
    return this.requireContext().role;
  }

  private requireContext(): TenantContext {
    const context = this.storage.getStore();
    if (!context) {
      throw new Error(
        'TenantContextService accessed outside of an active request scope. ' +
          'Ensure TenantContextInterceptor is registered globally.',
      );
    }
    return context;
  }
}

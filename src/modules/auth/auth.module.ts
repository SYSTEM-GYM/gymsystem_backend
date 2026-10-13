import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegisterThrottleService } from './register-throttle.service';
import { RegisterThrottleGuard } from './register-throttle.guard';

@Module({
  // In-memory store: attempt counters live per backend instance. Swap for a
  // Redis/Keyv store if the API is ever scaled horizontally.
  imports: [CacheModule.register()],
  controllers: [AuthController],
  providers: [AuthService, RegisterThrottleService, RegisterThrottleGuard],
  exports: [AuthService],
})
export class AuthModule {}

import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './shared/database/database.module';
import { TenantContextModule } from './shared/context/tenant-context.module';
import { TenantContextInterceptor } from './shared/interceptors/tenant-context.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { WorkoutsModule } from './modules/workouts/workouts.module';
import { FinanceModule } from './modules/finance/finance.module';
import { EcommModule } from './modules/ecomm/ecomm.module';
import { BiometricsModule } from './modules/biometrics/biometrics.module';
import { OccupancyModule } from './modules/occupancy/occupancy.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { AccessModule } from './modules/access/access.module';
import { StripeModule } from './modules/stripe/stripe.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    ScheduleModule.forRoot(),
    DatabaseModule,
    TenantContextModule,
    AuthModule,
    WorkoutsModule,
    FinanceModule,
    EcommModule,
    BiometricsModule,
    OccupancyModule,
    GamificationModule,
    AccessModule,
    StripeModule,
    WhatsappModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
  ],
})
export class AppModule {}

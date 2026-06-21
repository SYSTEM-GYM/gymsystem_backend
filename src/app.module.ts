import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './shared/database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { WorkoutsModule } from './modules/workouts/workouts.module';
import { FinanceModule } from './modules/finance/finance.module';
import { EcommModule } from './modules/ecomm/ecomm.module';
import { BiometricsModule } from './modules/biometrics/biometrics.module';
import { OccupancyModule } from './modules/occupancy/occupancy.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { AccessModule } from './modules/access/access.module';
import { StripeModule } from './modules/stripe/stripe.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    WorkoutsModule,
    FinanceModule,
    EcommModule,
    BiometricsModule,
    OccupancyModule,
    GamificationModule,
    AccessModule,
    StripeModule,
  ],
})
export class AppModule {}

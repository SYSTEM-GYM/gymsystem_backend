import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinanceCronService } from './finance-cron.service';

@Module({
  imports: [DatabaseModule],
  controllers: [FinanceController],
  providers: [FinanceService, FinanceCronService],
  exports: [FinanceService],
})
export class FinanceModule {}

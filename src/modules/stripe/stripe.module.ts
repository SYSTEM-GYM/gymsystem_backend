import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';

@Module({
  imports: [DatabaseModule],
  controllers: [StripeController],
  providers: [StripeService],
})
export class StripeModule {}

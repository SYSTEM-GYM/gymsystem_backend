import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { AdminGuard } from '../../shared/guards/admin.guard';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';

@Module({
  imports: [DatabaseModule],
  controllers: [WhatsappController],
  providers: [WhatsappService, AdminGuard],
  exports: [WhatsappService],
})
export class WhatsappModule {}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../shared/guards/admin.guard';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { SendMessageDto } from './dto/send-message.dto';
import { WhatsappService } from './whatsapp.service';

@Controller('v1/whatsapp')
@UseGuards(JwtAuthGuard, AdminGuard)
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Get('status')
  status() {
    return this.whatsappService.getStatus();
  }

  @Post('connect')
  @HttpCode(200)
  connect() {
    return this.whatsappService.connect();
  }

  @Post('disconnect')
  @HttpCode(200)
  disconnect() {
    return this.whatsappService.disconnect();
  }

  @Post('send')
  @HttpCode(200)
  send(@Body() dto: SendMessageDto) {
    return this.whatsappService.sendMessage(dto.phone, dto.content);
  }

  @Post('sync-contacts')
  @HttpCode(200)
  syncContacts() {
    return this.whatsappService.syncContactsFromChats();
  }
}

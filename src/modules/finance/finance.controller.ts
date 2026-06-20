import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
} from '@nestjs/common';
import { FinanceService } from './finance.service';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';

@Controller('finance')
export class FinanceController {
  private readonly logger = new Logger(FinanceController.name);

  constructor(private readonly financeService: FinanceService) {}

  @Get('health')
  health() {
    return { status: 'finance module ok' };
  }

  /**
   * POST /api/finance/webhooks/payment
   *
   * Generic payment gateway webhook receiver.
   * Always returns 200 immediately — gateways (Pix, credit) retry on non-2xx,
   * so we must ack fast and process safely with error isolation.
   */
  @Post('webhooks/payment')
  @HttpCode(200)
  async receivePaymentWebhook(@Body() dto: PaymentWebhookDto) {
    this.logger.log(
      `Webhook received: status=${dto.status} category=${dto.category} ref=${dto.external_reference}`,
    );

    const result = await this.financeService.processPaymentWebhook(dto);

    if (!result.success) {
      // Still return 200 — the gateway doesn't need to retry bad-reference events.
      // Internal errors (db_error) are logged; alerting/retries are handled out-of-band.
      this.logger.warn(`Webhook processed with failure reason: ${result.reason}`);
      return { received: true, processed: false, reason: result.reason };
    }

    return {
      received: true,
      processed: true,
      transaction_id: result.transactionId,
    };
  }
}

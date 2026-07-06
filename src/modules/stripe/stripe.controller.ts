import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { StripeService } from './stripe.service';

/**
 * POST /api/v1/webhooks/stripe
 *
 * Receives signed Stripe webhook events.
 *
 * Raw body is required for HMAC signature verification (see main.ts where
 * express.raw() is mounted before the global JSON parser for this path).
 *
 * Always returns HTTP 200 — Stripe retries on any non-2xx, so we ack fast
 * and process with isolated error handling.
 */
@Controller('v1/webhooks')
export class StripeController {
  private readonly logger = new Logger(StripeController.name);

  constructor(private readonly stripeService: StripeService) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string,
  ) {
    const rawBody = req.rawBody;

    if (!rawBody || !signature) {
      this.logger.warn(
        'Stripe webhook received without raw body or signature header',
      );
      throw new BadRequestException(
        'Missing raw body or Stripe-Signature header',
      );
    }

    const event = this.stripeService.constructEvent(rawBody, signature);

    if (!event) {
      // constructEvent already logged the reason; 400 causes Stripe to retry.
      throw new BadRequestException('Stripe signature verification failed');
    }

    const result = await this.stripeService.handleEvent(event);

    if (!result.handled) {
      this.logger.debug(`Stripe event not handled: ${result.reason}`);
    }

    return { received: true, handled: result.handled };
  }
}

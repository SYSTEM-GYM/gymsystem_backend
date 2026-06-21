import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AccessService } from './access.service';
import { ValidateAccessDto } from './dto/validate-access.dto';
import { EdgeApiKeyGuard } from '../../shared/guards/edge-api-key.guard';

/**
 * POST /api/v1/access/validate
 *
 * High-performance turnstile/QR-scanner endpoint.
 * Always returns HTTP 200 so hardware can read the body uniformly.
 *
 * Auth: X-Edge-Api-Key header (same shared secret as the occupancy module).
 *
 * Input (at least one required):
 *   { student_id?: string, qr_code_token?: string }
 *
 * Response:
 *   { allowed: true,  student_name: string, message: string }
 *   { allowed: false, message: string }
 */
@Controller('v1/access')
export class AccessController {
  constructor(private readonly accessService: AccessService) {}

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EdgeApiKeyGuard)
  async validate(@Body() dto: ValidateAccessDto) {
    return this.accessService.validate(dto);
  }
}

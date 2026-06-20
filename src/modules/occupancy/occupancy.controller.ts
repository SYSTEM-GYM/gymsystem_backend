import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { OccupancyService } from './occupancy.service';
import { ValidateQrDto } from './dto/validate-qr.dto';
import { EdgeApiKeyGuard } from '../../shared/guards/edge-api-key.guard';

@Controller('occupancy')
export class OccupancyController {
  constructor(private readonly occupancyService: OccupancyService) {}

  @Get('health')
  health() {
    return { status: 'occupancy module ok' };
  }

  /**
   * POST /api/occupancy/validate-qr
   *
   * Machine-to-machine endpoint called by the Local Edge Service (gym_edge)
   * after reading a QR code from the physical USB scanner.
   *
   * Auth: EdgeApiKeyGuard — requires X-Edge-Api-Key header matching EDGE_API_KEY
   * env var. No Supabase JWT needed — the edge daemon is not a human session.
   *
   * Returns the `granted` shape consumed by gym_edge/index.js:
   *   { granted: true,  member_name: string }
   *   { granted: false, reason: string }
   *
   * HTTP status is always 200 so the edge service can read the body uniformly.
   * A 4xx would only occur for invalid DTO or missing API key.
   */
  @Post('validate-qr')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EdgeApiKeyGuard)
  async validateQr(@Body() dto: ValidateQrDto) {
    return this.occupancyService.validateQrCode(dto);
  }
}

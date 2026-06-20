import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { OccupancyService } from './occupancy.service';
import { ValidateQrDto } from './dto/validate-qr.dto';

@Controller('occupancy')
export class OccupancyController {
  constructor(private readonly occupancyService: OccupancyService) {}

  @Get('health')
  health() {
    return { status: 'occupancy module ok' };
  }

  /**
   * POST /api/occupancy/validate-qr
   * Called by the Local Edge Service after capturing a QR scan.
   * Validates the HMAC token, checks user status, and persists the access log.
   */
  @Post('validate-qr')
  @HttpCode(HttpStatus.OK)
  async validateQr(@Body() dto: ValidateQrDto) {
    const result = await this.occupancyService.validateQr(dto);

    if (!result.success) {
      return {
        success: false,
        reason: result.reason,
        message: FAILURE_MESSAGES[result.reason],
      };
    }

    return {
      success: true,
      userId: result.userId,
      eventType: result.eventType,
      message: result.eventType === 'entry' ? 'Entrada registrada' : 'Saída registrada',
    };
  }
}

const FAILURE_MESSAGES: Record<string, string> = {
  invalid_format: 'Formato de QR inválido',
  invalid_signature: 'Assinatura inválida',
  expired_qr: 'QR expirado',
  inactive_user: 'Usuário inativo ou bloqueado',
  internal_error: 'Erro interno do servidor',
};

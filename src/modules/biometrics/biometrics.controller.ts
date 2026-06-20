import { Controller, Get } from '@nestjs/common';

// NOTE: This module stores only face_embedding_hash — never raw biometric images (LGPD)
@Controller('biometrics')
export class BiometricsController {
  @Get('health')
  health() {
    return { status: 'biometrics module ok' };
  }
}

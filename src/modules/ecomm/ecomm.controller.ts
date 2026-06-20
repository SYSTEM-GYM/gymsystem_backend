import { Controller, Get } from '@nestjs/common';

@Controller('ecomm')
export class EcommController {
  @Get('health')
  health() {
    return { status: 'ecomm module ok' };
  }
}

import { Controller, Get } from '@nestjs/common';

@Controller('workouts')
export class WorkoutsController {
  @Get('health')
  health() {
    return { status: 'workouts module ok' };
  }
}

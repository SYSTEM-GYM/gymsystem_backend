import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { WorkoutsService } from './workouts.service';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';

@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Get('health')
  health() {
    return { status: 'workouts module ok' };
  }

  @Get('today/:userId')
  @UseGuards(JwtAuthGuard)
  async getToday(@Param('userId', ParseUUIDPipe) userId: string) {
    const workout = await this.workoutsService.getTodayWorkout(userId);
    return { workout };
  }
}

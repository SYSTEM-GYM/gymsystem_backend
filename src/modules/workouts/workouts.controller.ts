import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { WorkoutsService } from './workouts.service';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';

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

  // PoC route for TenantContextService: no gymId param — resolved entirely
  // from the authenticated request's tenant scope.
  @Get('collections')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'gym_admin', 'trainer')
  async getCollectionsForCurrentGym() {
    const collections =
      await this.workoutsService.findAllCollectionsForCurrentGym();
    return { collections };
  }
}

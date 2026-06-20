import { Module } from '@nestjs/common';
import { OccupancyController } from './occupancy.controller';
import { OccupancyService } from './occupancy.service';

// SUPABASE_CLIENT is provided globally by DatabaseModule (imported in AppModule)
@Module({
  controllers: [OccupancyController],
  providers: [OccupancyService],
  exports: [OccupancyService],
})
export class OccupancyModule {}

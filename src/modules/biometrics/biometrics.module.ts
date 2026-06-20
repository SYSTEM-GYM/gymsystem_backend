import { Module } from '@nestjs/common';
import { BiometricsController } from './biometrics.controller';
import { BiometricsService } from './biometrics.service';

@Module({
  controllers: [BiometricsController],
  providers: [BiometricsService],
  exports: [BiometricsService],
})
export class BiometricsModule {}

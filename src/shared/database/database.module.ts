import { Global, Module } from '@nestjs/common';
import { SupabaseProvider } from './supabase.provider';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

@Global()
@Module({
  providers: [SupabaseProvider, JwtAuthGuard],
  exports: [SupabaseProvider, JwtAuthGuard],
})
export class DatabaseModule {}

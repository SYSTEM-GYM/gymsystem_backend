import { Global, Module } from '@nestjs/common';
import { SupabaseProvider } from './supabase.provider';

@Global()
@Module({
  providers: [SupabaseProvider],
  exports: [SupabaseProvider],
})
export class DatabaseModule {}

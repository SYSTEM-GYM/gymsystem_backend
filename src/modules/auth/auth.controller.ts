import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('health')
  health() {
    return { status: 'auth module ok' };
  }

  /**
   * POST /api/auth/register
   *
   * Staff-only account creation (future admin panel). The account is created
   * already confirmed (no confirmation e-mail), so it must never be public —
   * self-service sign-up uses Supabase Auth's native signUp + e-mail
   * confirmation in the frontend. 201 → { id, email }; 409 → e-mail in use;
   * 400 → validation error (message: string | string[]);
   * 401/403 → missing token or non-admin role.
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'gym_admin', 'master')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }
}

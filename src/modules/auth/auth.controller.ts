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
import { RegisterThrottleGuard } from './register-throttle.guard';

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
   * Public self-service sign-up. The account is created already confirmed
   * (no confirmation e-mail). 201 → { id, email }; 409 → e-mail in use;
   * 400 → validation error (message: string | string[]);
   * 429 → staggered backoff (15 → 30 → 60 min per IP/e-mail).
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RegisterThrottleGuard)
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }
}

import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Staff-created account payload. Role is intentionally absent: every
 * account created here is a 'customer' (set by the handle_new_user trigger),
 * and the global ValidationPipe rejects any extra field such as `role`.
 */
export class RegisterDto {
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(254)
  email: string;

  // 72 = bcrypt input limit used by Supabase Auth
  @IsString()
  @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres.' })
  @MaxLength(72, { message: 'A senha pode ter no máximo 72 caracteres.' })
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'Informe seu nome completo.' })
  @MaxLength(120)
  full_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  /** Home gym; omitted → the default gym (gyms.is_default) via the DB trigger. */
  @IsOptional()
  @IsUUID('4', { message: 'Unidade inválida.' })
  gym_id?: string;
}

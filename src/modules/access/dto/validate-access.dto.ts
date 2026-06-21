import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ValidateAccessDto {
  @IsOptional()
  @IsUUID()
  student_id?: string;

  @IsOptional()
  @IsString()
  qr_code_token?: string;
}

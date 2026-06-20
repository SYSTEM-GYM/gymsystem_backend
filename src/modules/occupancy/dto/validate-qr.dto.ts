import { IsIn, IsString, MinLength } from 'class-validator';

export class ValidateQrDto {
  @IsString()
  @MinLength(10)
  qr_hash: string;

  @IsIn(['entry', 'exit'])
  event_type: 'entry' | 'exit';
}

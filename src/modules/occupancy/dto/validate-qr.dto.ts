import { IsString, MinLength } from 'class-validator';

/**
 * Payload sent by the Local Edge Service after a USB QR scan.
 * qr_code: HMAC token (<base64_payload>.<signature>) or legacy raw UUID.
 */
export class ValidateQrDto {
  @IsString()
  @MinLength(1)
  qr_code: string;

  @IsString()
  @MinLength(1)
  gym_id: string;
}

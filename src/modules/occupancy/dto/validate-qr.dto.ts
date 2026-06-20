import { IsUUID, IsString, MinLength } from 'class-validator';

/**
 * Payload sent by the Local Edge Service after a USB QR scan.
 *
 * MVP simplification: qr_code is the raw user UUID stored in the QR.
 * Production upgrade path: replace with a signed HMAC token
 * (<base64_payload>.<base64_signature>) and verify in the service.
 */
export class ValidateQrDto {
  @IsUUID(4, { message: 'qr_code deve ser um UUID válido' })
  qr_code: string;

  @IsString()
  @MinLength(1)
  gym_id: string;
}

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/**
 * Machine-to-machine guard for the Local Edge Service.
 *
 * The edge daemon (gym_edge) is not a human user and cannot hold a Supabase
 * JWT session. Instead it sends a long shared secret in the X-Edge-Api-Key
 * header, configured via EDGE_API_KEY in both .env files.
 *
 * timingSafeEqual prevents timing-based side-channel attacks on the comparison.
 */
@Injectable()
export class EdgeApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expectedKey = process.env.EDGE_API_KEY;

    if (!expectedKey) {
      throw new UnauthorizedException('EDGE_API_KEY is not configured on this server');
    }

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const providedKey = request.headers['x-edge-api-key'];

    if (!providedKey) {
      throw new UnauthorizedException('Missing X-Edge-Api-Key header');
    }

    // Reject immediately if lengths differ to avoid Buffer allocation mismatch
    if (providedKey.length !== expectedKey.length) {
      throw new UnauthorizedException('Invalid API key');
    }

    const match = timingSafeEqual(
      Buffer.from(providedKey, 'utf8'),
      Buffer.from(expectedKey, 'utf8'),
    );

    if (!match) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, raw } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true exposes req.rawBody on all requests (needed for Stripe signature verification)
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix('api');

  // Mount raw body parser ONLY for the Stripe webhook route, before the global
  // JSON parser runs. This preserves the raw Buffer that Stripe's HMAC check needs.
  app.use('/api/v1/webhooks/stripe', raw({ type: 'application/json' }));

  // Default JSON parser for all other routes
  app.use(json());

  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Backend running on http://localhost:${port}/api`);
}
bootstrap();

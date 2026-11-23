import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config/app-config';
import { Rfc9457ExceptionFilter } from './shared-kernel/filters/rfc9457-exception.filter';
import { RedactedLogger } from './shared-kernel/logging/redacted-logger';

export function configureHttpApp(app: INestApplication, config: AppConfig): void {
  const logger = app.get(RedactedLogger);
  app.useLogger(logger);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: config.nodeEnv === 'production',
      noSniff: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  app.use(json({ limit: '8mb' }));
  app.use(cookieParser());

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Correlation-Id'],
  });

  // T-04 Mass Assignment protection: whitelist + forbidNonWhitelisted on all DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }),
  );

  app.useGlobalFilters(app.get(Rfc9457ExceptionFilter));
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get<AppConfig>(APP_CONFIG);
  configureHttpApp(app, config);
  await app.listen(config.port);

  const logger = app.get(RedactedLogger);
  logger.logEvent('log', 'server_started', 'Bootstrap', { port: config.port, env: config.nodeEnv });
}

if (require.main === module) {
  void bootstrap();
}

import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config/app-config';
import { DatabaseService } from './database/database.service';
import { runStartupMigrations } from './database/run-migrations';
import { Rfc9457ExceptionFilter } from './shared-kernel/filters/rfc9457-exception.filter';
import { RedactedLogger } from './shared-kernel/logging/redacted-logger';

export function configureHttpApp(app: INestApplication, config: AppConfig): void {
  const logger = app.get(RedactedLogger);
  app.useLogger(logger);

  // Trust first reverse-proxy hop (Render / Railway / Vercel rewrite) for real client IP in rate limiter
  const httpServer = app.getHttpAdapter().getInstance() as {
    set?: (key: string, value: unknown) => void;
  };
  httpServer.set?.('trust proxy', 1);

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
  const logger = app.get(RedactedLogger);
  configureHttpApp(app, config);
  app.enableShutdownHooks();

  if (process.env.AUTO_RUN_MIGRATIONS === 'true') {
    await runStartupMigrations(app.get(DatabaseService), logger);
  }

  await app.listen(config.port, '0.0.0.0');

  logger.logEvent('log', 'server_started', 'Bootstrap', { port: config.port, env: config.nodeEnv });
}

if (require.main === module) {
  void bootstrap();
}

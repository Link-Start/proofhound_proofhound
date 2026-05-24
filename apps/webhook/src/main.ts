import 'reflect-metadata';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { createHttpLogger, createLogger } from '@proofhound/logger';
import { json, urlencoded } from 'express';
import { PinoExceptionFilter } from './common/filters/pino-exception.filter';
import { envSchema } from './config/env.schema';
import { resolveListenPort } from './config/listen-port';
import { WebhookAppModule } from './app.module';

function loadRootEnv(): void {
  try {
    process.loadEnvFile(resolve(process.cwd(), '../../.env'));
  } catch {
    // CI / container deployments do not always mount a local .env file.
  }
}

async function bootstrap(): Promise<void> {
  loadRootEnv();

  const env = envSchema.parse(process.env);
  const listenPort = resolveListenPort(env);
  const logger = createLogger('webhook.bootstrap', { service: 'webhook-ingress', level: env.LOG_LEVEL });

  logger.info({}, 'webhook_ingress_bootstrap_start');
  const app = await NestFactory.create(WebhookAppModule, { bodyParser: false, abortOnError: true });
  app.use(json({ limit: env.WEBHOOK_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: env.WEBHOOK_BODY_LIMIT }));
  app.use(createHttpLogger({ service: 'webhook-ingress' }));
  app.useGlobalFilters(new PinoExceptionFilter());
  app.enableShutdownHooks();

  await app.listen(listenPort.port);
  logger.info(
    { port: listenPort.port, portSource: listenPort.source, bodyLimit: env.WEBHOOK_BODY_LIMIT },
    'webhook_ingress_started',
  );
}

bootstrap().catch((error: unknown) => {
  const logger = createLogger('webhook.bootstrap', { service: 'webhook-ingress' });
  logger.error({ error }, 'webhook_ingress_failed_to_start');
  process.exit(1);
});

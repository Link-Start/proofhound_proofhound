import { hostname } from 'node:os';
import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import { REDACT_PATHS } from './redact';

export interface CreateLoggerOptions {
  service?: string;
  version?: string;
  env?: string;
  level?: LoggerOptions['level'];
  base?: Record<string, unknown>;
  destination?: DestinationStream;
}

const DEFAULT_ENV = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'dev';

function defaultLevel(): LoggerOptions['level'] {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  return DEFAULT_ENV === 'production' ? 'info' : 'debug';
}

export function createLogger(namespace: string, options: CreateLoggerOptions = {}): Logger {
  const loggerOptions: LoggerOptions = {
    level: options.level ?? defaultLevel(),
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    base: {
      service: options.service ?? process.env.SERVICE_NAME ?? namespace,
      version: options.version ?? process.env.APP_VERSION ?? process.env.GIT_SHA ?? 'dev',
      env: options.env ?? DEFAULT_ENV,
      host: process.env.HOSTNAME ?? hostname(),
      namespace,
      ...options.base,
    },
  };

  if (options.destination) {
    return pino(loggerOptions, options.destination);
  }

  return pino(loggerOptions);
}

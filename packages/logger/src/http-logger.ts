import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import pinoHttp, { type Options as PinoHttpOptions } from 'pino-http';
import { createLogger, type CreateLoggerOptions } from './factory';

export interface CreateHttpLoggerOptions extends CreateLoggerOptions {
  ignoredPaths?: Array<string | RegExp>;
  autoLogging?: PinoHttpOptions['autoLogging'];
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function shouldIgnorePath(req: IncomingMessage, ignoredPaths: Array<string | RegExp>): boolean {
  const url = req.url ?? '';
  return ignoredPaths.some((path) => (typeof path === 'string' ? url.startsWith(path) : path.test(url)));
}

function getRequestId(req: IncomingMessage): unknown {
  return (req as IncomingMessage & { id?: unknown }).id;
}

function createLogObject(req: IncomingMessage, res: ServerResponse, durationMs: unknown) {
  return {
    requestId: getRequestId(req),
    req: {
      method: req.method,
      url: req.url,
      remoteAddress: req.socket.remoteAddress,
    },
    res: {
      statusCode: res.statusCode,
    },
    durationMs,
  };
}

export function createHttpLogger(options: CreateHttpLoggerOptions = {}) {
  const ignoredPaths = options.ignoredPaths ?? ['/health', '/healthz', '/readyz'];
  const logger = createLogger('http', {
    ...options,
    service: options.service ?? 'api',
  });

  return pinoHttp<IncomingMessage, ServerResponse>({
    logger,
    customAttributeKeys: {
      reqId: 'requestId',
      responseTime: 'durationMs',
    },
    autoLogging:
      options.autoLogging ??
      ({
        ignore: (req) => shouldIgnorePath(req, ignoredPaths),
      } satisfies PinoHttpOptions['autoLogging']),
    genReqId: (req, res) => {
      const requestId =
        getHeaderValue(req.headers['x-request-id']) ?? getHeaderValue(req.headers['x-correlation-id']) ?? randomUUID();

      res.setHeader('x-request-id', requestId);
      return requestId;
    },
    customProps: () => ({
      source: 'api',
    }),
    customSuccessMessage: () => 'http_request_completed',
    customErrorMessage: () => 'http_request_failed',
    customSuccessObject: (req, res, value) => createLogObject(req, res, value.durationMs),
    customErrorObject: (req, res, error, value) => ({
      ...createLogObject(req, res, value.durationMs),
      errorClass: error.name,
      errorMessage: error.message,
    }),
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  });
}

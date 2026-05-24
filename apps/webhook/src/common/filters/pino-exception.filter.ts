import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import { createLogger } from '@proofhound/logger';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class PinoExceptionFilter implements ExceptionFilter {
  private readonly logger = createLogger('exception.filter', { service: 'webhook-ingress' });

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request & { id?: unknown }>();
    const response = ctx.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        {
          err: exception,
          requestId: request.id,
          req: {
            method: request.method,
            url: request.originalUrl ?? request.url,
          },
          errorClass: exception instanceof Error ? exception.constructor.name : typeof exception,
        },
        'http_exception_thrown',
      );
    }

    response.status(status).json(this.toResponseBody(exception, status));
  }

  private toResponseBody(exception: unknown, status: number): Record<string, unknown> {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        return {
          statusCode: status,
          message: body,
        };
      }
      return body as Record<string, unknown>;
    }

    return {
      statusCode: status,
      message: 'Internal server error',
    };
  }
}

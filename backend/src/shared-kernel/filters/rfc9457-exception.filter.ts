import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ProblemDetailsDto, ProblemFieldErrorDto } from '@pfm/shared-types';
import {
  DomainException,
  RateLimitExceededException,
} from '../domain/domain-exceptions';
import { RedactedLogger } from '../logging/redacted-logger';

interface PgLikeError {
  code?: string;
  constraint?: string;
}

@Catch()
export class Rfc9457ExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: RedactedLogger) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined) ??
      (request.headers['x-request-id'] as string | undefined);

    const problem = this.toProblemDetails(exception, request.url, correlationId);

    this.logger.logEvent(
      problem.status >= 500 ? 'error' : 'warn',
      'http_exception',
      'Rfc9457ExceptionFilter',
      {
        status: problem.status,
        code: problem.code,
        method: request.method,
        path: request.path,
        correlationId,
      },
    );

    if (exception instanceof RateLimitExceededException) {
      response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    }

    response
      .status(problem.status)
      .setHeader('Content-Type', 'application/problem+json; charset=utf-8')
      .json(problem);
  }

  private toProblemDetails(
    exception: unknown,
    instance: string,
    correlationId?: string,
  ): ProblemDetailsDto {
    if (exception instanceof DomainException) {
      return {
        type: `https://api.pfm.local/errors/${exception.code.toLowerCase().replace(/_/g, '-')}`,
        title: exception.title,
        status: exception.status,
        detail: exception.message,
        instance,
        code: exception.code,
        ...(correlationId ? { correlationId } : {}),
        ...(exception.errors ? { errors: exception.errors } : {}),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const { detail, errors, code } = this.extractHttpExceptionDetail(status, body);

      return {
        type: `https://api.pfm.local/errors/${code.toLowerCase().replace(/_/g, '-')}`,
        title: HttpStatus[status] ?? 'HTTP Error',
        status,
        detail,
        instance,
        code,
        ...(correlationId ? { correlationId } : {}),
        ...(errors && errors.length > 0 ? { errors } : {}),
      };
    }

    const httpLike = exception as { status?: number; statusCode?: number; type?: string } | null;
    if (
      httpLike &&
      (httpLike.type === 'entity.too.large' ||
        httpLike.status === HttpStatus.PAYLOAD_TOO_LARGE ||
        httpLike.statusCode === HttpStatus.PAYLOAD_TOO_LARGE)
    ) {
      return {
        type: 'https://api.pfm.local/errors/payload-too-large',
        title: 'Payload Too Large',
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        detail: 'Request payload exceeds the maximum allowed size.',
        instance,
        code: 'PAYLOAD_TOO_LARGE',
        ...(correlationId ? { correlationId } : {}),
      };
    }

    const pgErr = exception as PgLikeError | null;
    if (pgErr && typeof pgErr.code === 'string') {
      if (pgErr.code === '23505') {
        return {
          type: 'https://api.pfm.local/errors/unique-constraint-violation',
          title: 'Conflict',
          status: HttpStatus.CONFLICT,
          detail: 'Resource conflicts with an existing record.',
          instance,
          code: 'RESOURCE_CONFLICT',
          ...(correlationId ? { correlationId } : {}),
        };
      }
      if (pgErr.code === '23503' || pgErr.code === '23514' || pgErr.code === '22P02') {
        return {
          type: 'https://api.pfm.local/errors/domain-constraint-violation',
          title: 'Unprocessable Entity',
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          detail: 'Request violates a data integrity or format constraint.',
          instance,
          code: 'CONSTRAINT_VIOLATION',
          ...(correlationId ? { correlationId } : {}),
        };
      }
    }

    return {
      type: 'https://api.pfm.local/errors/internal-server-error',
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'An unexpected internal error occurred.',
      instance,
      code: 'INTERNAL_SERVER_ERROR',
      ...(correlationId ? { correlationId } : {}),
    };
  }

  private extractHttpExceptionDetail(
    status: number,
    body: string | object,
  ): { detail: string; code: string; errors?: ProblemFieldErrorDto[] } {
    if (typeof body === 'string') {
      return {
        detail: body,
        code: status === 400 ? 'BAD_REQUEST' : `HTTP_${status}`,
      };
    }

    const record = body as Record<string, unknown>;
    const rawMessage = record.message;

    if (Array.isArray(rawMessage)) {
      const errors: ProblemFieldErrorDto[] = rawMessage.map((msg) => {
        const text = String(msg);
        const firstToken = text.split(' ')[0] ?? 'request';
        return {
          field: firstToken.replace(/[^a-zA-Z0-9_.[\]]/g, '') || 'request',
          message: text,
        };
      });
      return {
        detail: 'One or more request fields failed validation.',
        code: 'VALIDATION_ERROR',
        errors,
      };
    }

    return {
      detail: typeof rawMessage === 'string' ? rawMessage : 'Request could not be processed.',
      code: typeof record.code === 'string' ? record.code : `HTTP_${status}`,
    };
  }
}

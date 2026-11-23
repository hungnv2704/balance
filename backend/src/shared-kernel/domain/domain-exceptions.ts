import { HttpStatus } from '@nestjs/common';

export interface ProblemFieldError {
  field: string;
  message: string;
}

export abstract class DomainException extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly title: string;
  public readonly errors?: ProblemFieldError[];

  protected constructor(params: {
    status: number;
    code: string;
    title: string;
    detail: string;
    errors?: ProblemFieldError[];
  }) {
    super(params.detail);
    this.name = new.target.name;
    this.status = params.status;
    this.code = params.code;
    this.title = params.title;
    this.errors = params.errors;
  }
}

export class ValidationDomainException extends DomainException {
  constructor(detail: string, code = 'VALIDATION_ERROR', errors?: ProblemFieldError[]) {
    super({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code,
      title: 'Validation Failed',
      detail,
      errors,
    });
  }
}

export class InvalidCurrencyException extends DomainException {
  constructor(currencyCode: string) {
    super({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code: 'INVALID_CURRENCY',
      title: 'Unsupported Currency',
      detail: `Currency code '${currencyCode}' is not a supported ISO 4217 currency.`,
    });
  }
}

export class CurrencyMismatchException extends DomainException {
  constructor(expectedCurrency: string, actualCurrency: string) {
    super({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code: 'CURRENCY_MISMATCH',
      title: 'Currency Mismatch',
      detail: `Currency '${actualCurrency}' does not match required currency '${expectedCurrency}'.`,
    });
  }
}

export class InvalidStateTransitionException extends DomainException {
  constructor(detail: string, code = 'INVALID_STATE_TRANSITION') {
    super({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code,
      title: 'Invalid Lifecycle State Transition',
      detail,
    });
  }
}

export class LastActiveAccountException extends DomainException {
  constructor(detail = 'Cannot archive the last active account or the active default account before reassigning default.') {
    super({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code: 'LAST_ACTIVE_ACCOUNT_CANNOT_BE_ARCHIVED',
      title: 'Account Archive Guard Violated',
      detail,
    });
  }
}

export class DefaultAccountNotFoundException extends DomainException {
  constructor(detail = 'No active default account could be resolved for this user.') {
    super({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code: 'DEFAULT_ACCOUNT_NOT_FOUND',
      title: 'Default Account Unavailable',
      detail,
    });
  }
}

export class ResourceNotFoundException extends DomainException {
  constructor(resource = 'Resource') {
    super({
      status: HttpStatus.NOT_FOUND,
      code: 'RESOURCE_NOT_FOUND',
      title: 'Resource Not Found',
      detail: `${resource} was not found.`,
    });
  }
}

export class MissingIdempotencyKeyException extends DomainException {
  constructor(detail = 'Idempotency-Key header (UUIDv4) is required for financial write operations.') {
    super({
      status: HttpStatus.BAD_REQUEST,
      code: 'MISSING_IDEMPOTENCY_KEY',
      title: 'Missing Idempotency Key',
      detail,
    });
  }
}

export class InvalidIdempotencyKeyException extends DomainException {
  constructor(detail = 'Idempotency-Key header must be a valid UUIDv4.') {
    super({
      status: HttpStatus.BAD_REQUEST,
      code: 'INVALID_IDEMPOTENCY_KEY',
      title: 'Invalid Idempotency Key',
      detail,
    });
  }
}

export class IdempotencyConflictException extends DomainException {
  constructor(detail = 'Idempotency-Key was already used with a different request method, path, or payload.') {
    super({
      status: HttpStatus.CONFLICT,
      code: 'IDEMPOTENCY_KEY_CONFLICT',
      title: 'Idempotency Key Conflict',
      detail,
    });
  }
}

export class DomainConflictException extends DomainException {
  constructor(detail: string, code = 'CONFLICT') {
    super({
      status: HttpStatus.CONFLICT,
      code,
      title: 'Conflict',
      detail,
    });
  }
}

export class AuthenticationException extends DomainException {
  constructor(detail = 'Authentication is required or credentials are invalid.', code = 'UNAUTHORIZED') {
    super({
      status: HttpStatus.UNAUTHORIZED,
      code,
      title: 'Unauthorized',
      detail,
    });
  }
}

export class RateLimitExceededException extends DomainException {
  public readonly retryAfterSeconds: number;

  constructor(
    retryAfterSeconds: number,
    detail = `Too many requests. Please retry after ${Math.max(1, Math.ceil(retryAfterSeconds))} second(s).`,
  ) {
    super({
      status: HttpStatus.TOO_MANY_REQUESTS,
      code: 'RATE_LIMIT_EXCEEDED',
      title: 'Too Many Requests',
      detail,
    });
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

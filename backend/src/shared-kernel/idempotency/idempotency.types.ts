import { DbTransactionClient } from '../../database/database.types';

export const IDEMPOTENCY_REPOSITORY = Symbol('IDEMPOTENCY_REPOSITORY');

export interface IdempotencyRecord {
  readonly userId: string;
  readonly idempotencyKey: string;
  readonly requestMethod: string;
  readonly requestPath: string;
  readonly requestHash: string;
  readonly responseStatus: number | null;
  readonly responseBody: unknown;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface AcquireIdempotencyParams {
  readonly userId: string;
  readonly idempotencyKey: string;
  readonly requestMethod: string;
  readonly requestPath: string;
  readonly requestHash: string;
  readonly expiresAt: Date;
}

export type AcquireIdempotencyResult =
  | { readonly kind: 'ACQUIRED' }
  | { readonly kind: 'REPLAY'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'CONFLICT' }
  | { readonly kind: 'IN_PROGRESS' };

export interface IdempotencyRepository {
  acquireOrReplay(
    tx: DbTransactionClient,
    params: AcquireIdempotencyParams,
  ): Promise<AcquireIdempotencyResult>;

  saveResponse(
    tx: DbTransactionClient,
    userId: string,
    idempotencyKey: string,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void>;
}

export interface IdempotencyExecutionResult<T> {
  readonly replayed: boolean;
  readonly status: number;
  readonly body: T;
}

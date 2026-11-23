import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DbTransactionClient } from '../../database/database.types';
import {
  DomainConflictException,
  IdempotencyConflictException,
  InvalidIdempotencyKeyException,
  MissingIdempotencyKeyException,
} from '../domain/domain-exceptions';
import {
  IDEMPOTENCY_REPOSITORY,
  IdempotencyExecutionResult,
  IdempotencyRepository,
} from './idempotency.types';

// Strict UUIDv4 validation per docs/03 Section 3.2
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_IDEMPOTENCY_TTL_HOURS = 24;

function canonicalizeForHash(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeForHash(item));
  }
  if (typeof value === 'object') {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const out: Record<string, unknown> = {};
    for (const k of sortedKeys) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) {
        out[k] = canonicalizeForHash(v);
      }
    }
    return out;
  }
  return value;
}

@Injectable()
export class IdempotencyService {
  constructor(
    @Inject(IDEMPOTENCY_REPOSITORY)
    private readonly repository: IdempotencyRepository,
  ) {}

  public validateKey(rawKey: string | string[] | undefined): string {
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!key || key.trim().length === 0) {
      throw new MissingIdempotencyKeyException();
    }
    const normalized = key.trim().toLowerCase();
    if (!UUID_V4_REGEX.test(normalized)) {
      throw new InvalidIdempotencyKeyException();
    }
    return normalized;
  }

  public computeRequestHash(method: string, path: string, payload: unknown): string {
    const canonical = JSON.stringify({
      method: method.toUpperCase(),
      path,
      payload: canonicalizeForHash(payload ?? {}),
    });
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  public async execute<T>(
    tx: DbTransactionClient,
    params: {
      userId: string;
      idempotencyKey?: string | string[];
      method: string;
      path: string;
      payload: unknown;
      ttlHours?: number;
    },
    operation: () => Promise<{ status: number; body: T }>,
  ): Promise<IdempotencyExecutionResult<T>> {
    const validatedKey = this.validateKey(params.idempotencyKey);
    const requestHash = this.computeRequestHash(params.method, params.path, params.payload);
    const ttlMs = (params.ttlHours ?? DEFAULT_IDEMPOTENCY_TTL_HOURS) * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + ttlMs);

    const decision = await this.repository.acquireOrReplay(tx, {
      userId: params.userId,
      idempotencyKey: validatedKey,
      requestMethod: params.method.toUpperCase(),
      requestPath: params.path,
      requestHash,
      expiresAt,
    });

    if (decision.kind === 'CONFLICT') {
      throw new IdempotencyConflictException();
    }
    if (decision.kind === 'IN_PROGRESS') {
      throw new DomainConflictException(
        'An identical request with this Idempotency-Key is currently in progress.',
        'IDEMPOTENCY_REQUEST_IN_PROGRESS',
      );
    }
    if (decision.kind === 'REPLAY') {
      return {
        replayed: true,
        status: decision.status,
        body: decision.body as T,
      };
    }

    const result = await operation();
    await this.repository.saveResponse(
      tx,
      params.userId,
      validatedKey,
      result.status,
      result.body,
    );

    return {
      replayed: false,
      status: result.status,
      body: result.body,
    };
  }
}

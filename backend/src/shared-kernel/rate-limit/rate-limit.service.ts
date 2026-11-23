import { Injectable, OnModuleDestroy } from '@nestjs/common';

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
  readonly resetEpochSeconds: number;
}

interface RateLimitBucket {
  timestamps: number[];
  expiresAtMs: number;
}

@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private static readonly MAX_BUCKETS = 10_000;
  private readonly buckets = new Map<string, RateLimitBucket>();

  public consume(
    key: string,
    maxRequests: number,
    windowSeconds: number,
    nowMs: number = Date.now(),
  ): RateLimitDecision {
    const windowMs = windowSeconds * 1000;
    const windowStartMs = nowMs - windowMs;

    const existing = this.buckets.get(key);
    const activeTimestamps = existing
      ? existing.timestamps.filter((ts) => ts > windowStartMs)
      : [];

    if (activeTimestamps.length >= maxRequests) {
      const oldestActiveMs = activeTimestamps[0] ?? nowMs;
      const retryAfterMs = Math.max(1000, oldestActiveMs + windowMs - nowMs);
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
      const resetEpochSeconds = Math.ceil((oldestActiveMs + windowMs) / 1000);

      // Re-insert to keep LRU ordering fresh while bounded
      this.buckets.delete(key);
      this.buckets.set(key, {
        timestamps: activeTimestamps,
        expiresAtMs: (activeTimestamps[activeTimestamps.length - 1] ?? nowMs) + windowMs,
      });

      return {
        allowed: false,
        limit: maxRequests,
        remaining: 0,
        retryAfterSeconds,
        resetEpochSeconds,
      };
    }

    activeTimestamps.push(nowMs);
    this.buckets.delete(key);
    this.buckets.set(key, {
      timestamps: activeTimestamps,
      expiresAtMs: nowMs + windowMs,
    });

    if (this.buckets.size > RateLimitService.MAX_BUCKETS) {
      this.pruneExpiredOrOldest(nowMs);
    }

    const oldestActiveMs = activeTimestamps[0] ?? nowMs;
    const resetEpochSeconds = Math.ceil((oldestActiveMs + windowMs) / 1000);

    return {
      allowed: true,
      limit: maxRequests,
      remaining: Math.max(0, maxRequests - activeTimestamps.length),
      retryAfterSeconds: 0,
      resetEpochSeconds,
    };
  }

  public onModuleDestroy(): void {
    this.buckets.clear();
  }

  private pruneExpiredOrOldest(nowMs: number): void {
    for (const [k, bucket] of this.buckets.entries()) {
      if (bucket.expiresAtMs <= nowMs) {
        this.buckets.delete(k);
      }
      if (this.buckets.size <= RateLimitService.MAX_BUCKETS) {
        return;
      }
    }

    while (this.buckets.size > RateLimitService.MAX_BUCKETS) {
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.buckets.delete(oldestKey);
    }
  }
}

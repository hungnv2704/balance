import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import {
  DatabaseExecutor,
  DbTransactionClient,
  QueryResultLike,
} from './database.types';

@Injectable()
export class DatabaseService implements DatabaseExecutor, OnModuleDestroy {
  private readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const isLocalDb =
      config.databaseUrl.includes('localhost') || config.databaseUrl.includes('127.0.0.1');
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: config.pgPoolMax,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      ssl:
        config.nodeEnv === 'production' && !isLocalDb
          ? { rejectUnauthorized: false }
          : undefined,
    });
  }

  public async query<R = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<QueryResultLike<R>> {
    const result = await this.pool.query<R & QueryResultRow>(text, params as unknown[] | undefined);
    return {
      rows: result.rows,
      rowCount: result.rowCount,
    };
  }

  public async withTransaction<T>(
    fn: (tx: DbTransactionClient) => Promise<T>,
  ): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txClient: DbTransactionClient = {
        isTransaction: true,
        query: async <R = Record<string, unknown>>(
          text: string,
          params?: ReadonlyArray<unknown>,
        ): Promise<QueryResultLike<R>> => {
          const res = await client.query<R & QueryResultRow>(text, params as unknown[] | undefined);
          return {
            rows: res.rows,
            rowCount: res.rowCount,
          };
        },
      };

      const result = await fn(txClient);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve original exception when rollback also fails
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

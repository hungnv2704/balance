export interface QueryResultLike<R = Record<string, unknown>> {
  readonly rows: R[];
  readonly rowCount: number | null;
}

export interface DbQueryClient {
  query<R = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<QueryResultLike<R>>;
}

export interface DbTransactionClient extends DbQueryClient {
  readonly isTransaction: true;
}

export interface DatabaseExecutor extends DbQueryClient {
  withTransaction<T>(fn: (tx: DbTransactionClient) => Promise<T>): Promise<T>;
}

export const DATABASE_EXECUTOR = Symbol('DATABASE_EXECUTOR');

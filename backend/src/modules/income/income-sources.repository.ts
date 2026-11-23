import { IncomeSourceDto } from '@pfm/shared-types';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';

export const INCOME_SOURCES_REPOSITORY = Symbol('INCOME_SOURCES_REPOSITORY');

export interface IncomeSourceEntity {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
}

export function toIncomeSourceDto(entity: IncomeSourceEntity): IncomeSourceDto {
  return {
    id: entity.id,
    name: entity.name,
    archivedAt: entity.archivedAt ? entity.archivedAt.toISOString() : null,
    createdAt: entity.createdAt.toISOString(),
  };
}

export interface IncomeSourcesRepository {
  findById(
    db: DbQueryClient,
    userId: string,
    incomeSourceId: string,
  ): Promise<IncomeSourceEntity | null>;

  list(db: DbQueryClient, userId: string, includeArchived?: boolean): Promise<IncomeSourceEntity[]>;

  create(tx: DbTransactionClient, userId: string, name: string): Promise<IncomeSourceEntity>;
}

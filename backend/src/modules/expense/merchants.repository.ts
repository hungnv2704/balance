import { MerchantDto } from '@pfm/shared-types';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';

export const MERCHANTS_REPOSITORY = Symbol('MERCHANTS_REPOSITORY');

export interface MerchantEntity {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
}

export function toMerchantDto(entity: MerchantEntity): MerchantDto {
  return {
    id: entity.id,
    name: entity.name,
    archivedAt: entity.archivedAt ? entity.archivedAt.toISOString() : null,
    createdAt: entity.createdAt.toISOString(),
  };
}

export interface MerchantsRepository {
  findById(
    db: DbQueryClient,
    userId: string,
    merchantId: string,
  ): Promise<MerchantEntity | null>;

  list(db: DbQueryClient, userId: string, includeArchived?: boolean): Promise<MerchantEntity[]>;

  create(tx: DbTransactionClient, userId: string, name: string): Promise<MerchantEntity>;
}

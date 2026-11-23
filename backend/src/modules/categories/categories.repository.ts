import { CategoryKind } from '@pfm/shared-types';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import { CategoryEntity } from './categories.types';

export const CATEGORIES_REPOSITORY = Symbol('CATEGORIES_REPOSITORY');

export interface CategoriesRepository {
  findById(
    db: DbQueryClient,
    userId: string,
    categoryId: string,
  ): Promise<CategoryEntity | null>;

  findActiveByName(
    db: DbQueryClient,
    userId: string,
    kind: CategoryKind,
    name: string,
  ): Promise<CategoryEntity | null>;

  list(
    db: DbQueryClient,
    userId: string,
    kind?: CategoryKind,
    includeArchived?: boolean,
  ): Promise<CategoryEntity[]>;

  create(
    tx: DbTransactionClient,
    input: {
      userId: string;
      kind: CategoryKind;
      name: string;
      parentId?: string | null;
    },
  ): Promise<CategoryEntity>;

  seedDefaultCategories(tx: DbTransactionClient, userId: string): Promise<void>;

  updateName(
    tx: DbTransactionClient,
    userId: string,
    categoryId: string,
    name: string,
  ): Promise<CategoryEntity>;

  archive(
    tx: DbTransactionClient,
    userId: string,
    categoryId: string,
  ): Promise<CategoryEntity>;
}

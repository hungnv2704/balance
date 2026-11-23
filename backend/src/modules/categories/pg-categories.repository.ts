import { Injectable } from '@nestjs/common';
import { CategoryKind } from '@pfm/shared-types';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import { CategoriesRepository } from './categories.repository';
import { CategoryEntity } from './categories.types';

interface CategoryRow {
  id: string;
  user_id: string;
  kind: CategoryKind;
  name: string;
  parent_id: string | null;
  archived_at: Date | null;
  created_at: Date;
}

function mapRow(row: CategoryRow): CategoryEntity {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    name: row.name,
    parentId: row.parent_id,
    archivedAt: row.archived_at,
    createdAt: new Date(row.created_at),
  };
}

const DEFAULT_INCOME_CATEGORIES = ['Lương', 'Thưởng', 'Freelance', 'Thu nhập khác'];
const DEFAULT_EXPENSE_CATEGORIES = ['Ăn uống', 'Di chuyển', 'Nhà ở', 'Mua sắm', 'Hóa đơn', 'Chi tiêu khác'];

@Injectable()
export class PgCategoriesRepository implements CategoriesRepository {
  public async findById(
    db: DbQueryClient,
    userId: string,
    categoryId: string,
  ): Promise<CategoryEntity | null> {
    const result = await db.query<CategoryRow>(
      `SELECT id, user_id, kind, name, parent_id, archived_at, created_at
       FROM categories
       WHERE id = $1 AND user_id = $2`,
      [categoryId, userId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  public async findActiveByName(
    db: DbQueryClient,
    userId: string,
    kind: CategoryKind,
    name: string,
  ): Promise<CategoryEntity | null> {
    const result = await db.query<CategoryRow>(
      `SELECT id, user_id, kind, name, parent_id, archived_at, created_at
       FROM categories
       WHERE user_id = $1 AND kind = $2 AND lower(name) = lower($3) AND archived_at IS NULL
       LIMIT 1`,
      [userId, kind, name.trim()],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  public async list(
    db: DbQueryClient,
    userId: string,
    kind?: CategoryKind,
    includeArchived = false,
  ): Promise<CategoryEntity[]> {
    const params: unknown[] = [userId];
    const conditions = ['user_id = $1'];
    if (kind) {
      params.push(kind);
      conditions.push(`kind = $${params.length}`);
    }
    if (!includeArchived) {
      conditions.push('archived_at IS NULL');
    }

    const result = await db.query<CategoryRow>(
      `SELECT id, user_id, kind, name, parent_id, archived_at, created_at
       FROM categories
       WHERE ${conditions.join(' AND ')}
       ORDER BY kind ASC, lower(name) ASC`,
      params,
    );
    return result.rows.map(mapRow);
  }

  public async create(
    tx: DbTransactionClient,
    input: { userId: string; kind: CategoryKind; name: string; parentId?: string | null },
  ): Promise<CategoryEntity> {
    const result = await tx.query<CategoryRow>(
      `INSERT INTO categories (user_id, kind, name, parent_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, kind, name, parent_id, archived_at, created_at`,
      [input.userId, input.kind, input.name.trim(), input.parentId ?? null],
    );
    return mapRow(result.rows[0]);
  }

  public async seedDefaultCategories(tx: DbTransactionClient, userId: string): Promise<void> {
    for (const name of DEFAULT_INCOME_CATEGORIES) {
      await tx.query(
        `INSERT INTO categories (user_id, kind, name)
         VALUES ($1, 'INCOME', $2)
         ON CONFLICT DO NOTHING`,
        [userId, name],
      );
    }
    for (const name of DEFAULT_EXPENSE_CATEGORIES) {
      await tx.query(
        `INSERT INTO categories (user_id, kind, name)
         VALUES ($1, 'EXPENSE', $2)
         ON CONFLICT DO NOTHING`,
        [userId, name],
      );
    }
  }

  public async updateName(
    tx: DbTransactionClient,
    userId: string,
    categoryId: string,
    name: string,
  ): Promise<CategoryEntity> {
    const result = await tx.query<CategoryRow>(
      `UPDATE categories
       SET name = $3
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, kind, name, parent_id, archived_at, created_at`,
      [categoryId, userId, name.trim()],
    );
    return mapRow(result.rows[0]);
  }

  public async archive(
    tx: DbTransactionClient,
    userId: string,
    categoryId: string,
  ): Promise<CategoryEntity> {
    const result = await tx.query<CategoryRow>(
      `UPDATE categories
       SET archived_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, kind, name, parent_id, archived_at, created_at`,
      [categoryId, userId],
    );
    return mapRow(result.rows[0]);
  }
}

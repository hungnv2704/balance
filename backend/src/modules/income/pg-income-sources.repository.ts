import { Injectable } from '@nestjs/common';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import {
  IncomeSourceEntity,
  IncomeSourcesRepository,
} from './income-sources.repository';

interface IncomeSourceRow {
  id: string;
  user_id: string;
  name: string;
  archived_at: Date | null;
  created_at: Date;
}

function mapRow(row: IncomeSourceRow): IncomeSourceEntity {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    archivedAt: row.archived_at,
    createdAt: new Date(row.created_at),
  };
}

@Injectable()
export class PgIncomeSourcesRepository implements IncomeSourcesRepository {
  public async findById(
    db: DbQueryClient,
    userId: string,
    incomeSourceId: string,
  ): Promise<IncomeSourceEntity | null> {
    const result = await db.query<IncomeSourceRow>(
      `SELECT id, user_id, name, archived_at, created_at
       FROM income_sources
       WHERE id = $1 AND user_id = $2`,
      [incomeSourceId, userId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  public async list(
    db: DbQueryClient,
    userId: string,
    includeArchived = false,
  ): Promise<IncomeSourceEntity[]> {
    const sql = includeArchived
      ? `SELECT id, user_id, name, archived_at, created_at
         FROM income_sources
         WHERE user_id = $1
         ORDER BY lower(name) ASC`
      : `SELECT id, user_id, name, archived_at, created_at
         FROM income_sources
         WHERE user_id = $1 AND archived_at IS NULL
         ORDER BY lower(name) ASC`;
    const result = await db.query<IncomeSourceRow>(sql, [userId]);
    return result.rows.map(mapRow);
  }

  public async create(
    tx: DbTransactionClient,
    userId: string,
    name: string,
  ): Promise<IncomeSourceEntity> {
    const result = await tx.query<IncomeSourceRow>(
      `INSERT INTO income_sources (user_id, name)
       VALUES ($1, $2)
       RETURNING id, user_id, name, archived_at, created_at`,
      [userId, name.trim()],
    );
    return mapRow(result.rows[0]);
  }
}

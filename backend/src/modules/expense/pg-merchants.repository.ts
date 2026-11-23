import { Injectable } from '@nestjs/common';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import { MerchantEntity, MerchantsRepository } from './merchants.repository';

interface MerchantRow {
  id: string;
  user_id: string;
  name: string;
  archived_at: Date | null;
  created_at: Date;
}

function mapRow(row: MerchantRow): MerchantEntity {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    archivedAt: row.archived_at,
    createdAt: new Date(row.created_at),
  };
}

@Injectable()
export class PgMerchantsRepository implements MerchantsRepository {
  public async findById(
    db: DbQueryClient,
    userId: string,
    merchantId: string,
  ): Promise<MerchantEntity | null> {
    const result = await db.query<MerchantRow>(
      `SELECT id, user_id, name, archived_at, created_at
       FROM merchants
       WHERE id = $1 AND user_id = $2`,
      [merchantId, userId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  public async list(
    db: DbQueryClient,
    userId: string,
    includeArchived = false,
  ): Promise<MerchantEntity[]> {
    const sql = includeArchived
      ? `SELECT id, user_id, name, archived_at, created_at
         FROM merchants
         WHERE user_id = $1
         ORDER BY lower(name) ASC`
      : `SELECT id, user_id, name, archived_at, created_at
         FROM merchants
         WHERE user_id = $1 AND archived_at IS NULL
         ORDER BY lower(name) ASC`;
    const result = await db.query<MerchantRow>(sql, [userId]);
    return result.rows.map(mapRow);
  }

  public async create(
    tx: DbTransactionClient,
    userId: string,
    name: string,
  ): Promise<MerchantEntity> {
    const result = await tx.query<MerchantRow>(
      `INSERT INTO merchants (user_id, name)
       VALUES ($1, $2)
       RETURNING id, user_id, name, archived_at, created_at`,
      [userId, name.trim()],
    );
    return mapRow(result.rows[0]);
  }
}

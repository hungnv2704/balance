import { Injectable } from '@nestjs/common';
import { AttachmentMimeType } from '@pfm/shared-types';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import { AttachmentsRepository, CreateAttachmentInput } from './attachments.repository';
import { TransactionAttachmentEntity } from './attachments.types';

interface AttachmentRow {
  id: string;
  user_id: string;
  transaction_id: string;
  original_filename: string;
  stored_filename: string;
  mime_type: AttachmentMimeType;
  size_bytes: number;
  sha256_hash: string;
  created_at: Date;
}

function mapAttachmentRow(row: AttachmentRow): TransactionAttachmentEntity {
  return {
    id: row.id,
    userId: row.user_id,
    transactionId: row.transaction_id,
    originalFilename: row.original_filename,
    storedFilename: row.stored_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sha256Hash: row.sha256_hash,
    createdAt: new Date(row.created_at),
  };
}

const SELECT_ATTACHMENT_COLUMNS = `
  id, user_id, transaction_id, original_filename, stored_filename,
  mime_type, size_bytes, sha256_hash, created_at
`;

@Injectable()
export class PgAttachmentsRepository implements AttachmentsRepository {
  public async listByTransaction(
    db: DbQueryClient,
    userId: string,
    transactionId: string,
  ): Promise<TransactionAttachmentEntity[]> {
    const result = await db.query<AttachmentRow>(
      `SELECT ${SELECT_ATTACHMENT_COLUMNS}
       FROM transaction_attachments
       WHERE user_id = $1 AND transaction_id = $2
       ORDER BY created_at ASC, id ASC`,
      [userId, transactionId],
    );
    return result.rows.map(mapAttachmentRow);
  }

  public async countByTransaction(
    db: DbQueryClient,
    userId: string,
    transactionId: string,
  ): Promise<number> {
    const result = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt
       FROM transaction_attachments
       WHERE user_id = $1 AND transaction_id = $2`,
      [userId, transactionId],
    );
    return result.rows[0]?.cnt ?? 0;
  }

  public async findById(
    db: DbQueryClient,
    userId: string,
    attachmentId: string,
  ): Promise<TransactionAttachmentEntity | null> {
    const result = await db.query<AttachmentRow>(
      `SELECT ${SELECT_ATTACHMENT_COLUMNS}
       FROM transaction_attachments
       WHERE id = $1 AND user_id = $2`,
      [attachmentId, userId],
    );
    return result.rows[0] ? mapAttachmentRow(result.rows[0]) : null;
  }

  public async insert(
    tx: DbTransactionClient,
    input: CreateAttachmentInput,
  ): Promise<TransactionAttachmentEntity> {
    const result = await tx.query<AttachmentRow>(
      `INSERT INTO transaction_attachments (
         user_id, transaction_id, original_filename, stored_filename,
         mime_type, size_bytes, sha256_hash
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${SELECT_ATTACHMENT_COLUMNS}`,
      [
        input.userId,
        input.transactionId,
        input.originalFilename,
        input.storedFilename,
        input.mimeType,
        input.sizeBytes,
        input.sha256Hash,
      ],
    );
    return mapAttachmentRow(result.rows[0]);
  }

  public async deleteById(
    tx: DbTransactionClient,
    userId: string,
    attachmentId: string,
  ): Promise<TransactionAttachmentEntity | null> {
    const result = await tx.query<AttachmentRow>(
      `DELETE FROM transaction_attachments
       WHERE id = $1 AND user_id = $2
       RETURNING ${SELECT_ATTACHMENT_COLUMNS}`,
      [attachmentId, userId],
    );
    return result.rows[0] ? mapAttachmentRow(result.rows[0]) : null;
  }
}

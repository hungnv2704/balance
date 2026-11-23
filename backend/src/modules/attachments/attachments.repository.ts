import { AttachmentMimeType } from '@pfm/shared-types';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import { TransactionAttachmentEntity } from './attachments.types';

export const ATTACHMENTS_REPOSITORY = Symbol('ATTACHMENTS_REPOSITORY');

export interface CreateAttachmentInput {
  readonly userId: string;
  readonly transactionId: string;
  readonly originalFilename: string;
  readonly storedFilename: string;
  readonly mimeType: AttachmentMimeType;
  readonly sizeBytes: number;
  readonly sha256Hash: string;
}

export interface AttachmentsRepository {
  listByTransaction(
    db: DbQueryClient,
    userId: string,
    transactionId: string,
  ): Promise<TransactionAttachmentEntity[]>;

  countByTransaction(
    db: DbQueryClient,
    userId: string,
    transactionId: string,
  ): Promise<number>;

  findById(
    db: DbQueryClient,
    userId: string,
    attachmentId: string,
  ): Promise<TransactionAttachmentEntity | null>;

  insert(
    tx: DbTransactionClient,
    input: CreateAttachmentInput,
  ): Promise<TransactionAttachmentEntity>;

  deleteById(
    tx: DbTransactionClient,
    userId: string,
    attachmentId: string,
  ): Promise<TransactionAttachmentEntity | null>;
}

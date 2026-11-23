import { AttachmentDto, AttachmentMimeType } from '@pfm/shared-types';

export interface TransactionAttachmentEntity {
  readonly id: string;
  readonly userId: string;
  readonly transactionId: string;
  readonly originalFilename: string;
  readonly storedFilename: string;
  readonly mimeType: AttachmentMimeType;
  readonly sizeBytes: number;
  readonly sha256Hash: string;
  readonly createdAt: Date;
}

export function toAttachmentDto(entity: TransactionAttachmentEntity): AttachmentDto {
  return {
    id: entity.id,
    transactionId: entity.transactionId,
    originalFilename: entity.originalFilename,
    mimeType: entity.mimeType,
    sizeBytes: entity.sizeBytes,
    sha256Hash: entity.sha256Hash,
    createdAt: entity.createdAt.toISOString(),
  };
}

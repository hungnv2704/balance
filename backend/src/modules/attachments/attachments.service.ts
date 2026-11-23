import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import { AttachmentDto, AttachmentListResponseDto } from '@pfm/shared-types';
import { DATABASE_EXECUTOR, DatabaseExecutor } from '../../database/database.types';
import {
  ResourceNotFoundException,
  ValidationDomainException,
} from '../../shared-kernel/domain/domain-exceptions';
import { AUDIT_REPOSITORY, AuditRepository } from '../audit/audit.repository';
import { LEDGER_REPOSITORY, LedgerRepository } from '../ledger/ledger.repository';
import { UploadAttachmentDto } from './attachments.dto';
import { ATTACHMENTS_REPOSITORY, AttachmentsRepository } from './attachments.repository';
import { TransactionAttachmentEntity, toAttachmentDto } from './attachments.types';
import { LocalAttachmentStorage } from './local-attachment.storage';
import {
  decodeAndValidateAttachmentBase64,
  detectAllowedAttachmentType,
  formatContentDispositionFilename,
  MAX_ATTACHMENTS_PER_TRANSACTION,
  sanitizeAttachmentFilename,
} from './magic-bytes';

export interface PreparedAttachmentDownload {
  readonly attachment: TransactionAttachmentEntity;
  readonly size: number;
  readonly stream: Readable;
  readonly contentDisposition: string;
}

@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(DATABASE_EXECUTOR) private readonly db: DatabaseExecutor,
    @Inject(LEDGER_REPOSITORY) private readonly ledgerRepo: LedgerRepository,
    @Inject(ATTACHMENTS_REPOSITORY) private readonly attachmentsRepo: AttachmentsRepository,
    @Inject(AUDIT_REPOSITORY) private readonly auditRepo: AuditRepository,
    private readonly storage: LocalAttachmentStorage,
  ) {}

  public async listForTransaction(
    userId: string,
    transactionId: string,
  ): Promise<AttachmentListResponseDto> {
    const txRecord = await this.ledgerRepo.findById(this.db, userId, transactionId);
    if (!txRecord) {
      throw new ResourceNotFoundException('Transaction');
    }

    const items = await this.attachmentsRepo.listByTransaction(this.db, userId, transactionId);
    return {
      items: items.map(toAttachmentDto),
    };
  }

  public async upload(
    userId: string,
    transactionId: string,
    dto: UploadAttachmentDto,
  ): Promise<AttachmentDto> {
    const originalFilename = sanitizeAttachmentFilename(dto.filename);
    const buffer = decodeAndValidateAttachmentBase64(dto.contentBase64);
    const detected = detectAllowedAttachmentType(buffer);
    if (!detected) {
      throw new ValidationDomainException(
        'File type is not allowed. Only PNG, JPEG, and PDF files matching magic bytes are accepted.',
        'INVALID_FILE_TYPE',
      );
    }

    const sha256Hash = createHash('sha256').update(buffer).digest('hex');
    const storedFilename = `${randomUUID()}.${detected.extension}`;

    const created = await this.db.withTransaction(async (tx) => {
      const txRecord = await this.ledgerRepo.findById(tx, userId, transactionId, undefined, true);
      if (!txRecord) {
        throw new ResourceNotFoundException('Transaction');
      }

      const existingCount = await this.attachmentsRepo.countByTransaction(
        tx,
        userId,
        transactionId,
      );
      if (existingCount >= MAX_ATTACHMENTS_PER_TRANSACTION) {
        throw new ValidationDomainException(
          `A transaction can have at most ${MAX_ATTACHMENTS_PER_TRANSACTION} attachments.`,
          'ATTACHMENT_LIMIT_EXCEEDED',
        );
      }

      await this.storage.save(storedFilename, buffer);
      try {
        const inserted = await this.attachmentsRepo.insert(tx, {
          userId,
          transactionId,
          originalFilename,
          storedFilename,
          mimeType: detected.mimeType,
          sizeBytes: buffer.length,
          sha256Hash,
        });

        await this.auditRepo.record(tx, {
          userId,
          entityType: 'transaction_attachment',
          entityId: inserted.id,
          action: 'ATTACHMENT_UPLOADED',
          metadata: {
            transactionId,
            mimeType: inserted.mimeType,
            sizeBytes: inserted.sizeBytes,
          },
        });

        return inserted;
      } catch (error) {
        await this.storage.delete(storedFilename).catch(() => undefined);
        throw error;
      }
    });

    return toAttachmentDto(created);
  }

  public async prepareDownload(
    userId: string,
    attachmentId: string,
  ): Promise<PreparedAttachmentDownload> {
    const attachment = await this.attachmentsRepo.findById(this.db, userId, attachmentId);
    if (!attachment) {
      throw new ResourceNotFoundException('Attachment');
    }

    const opened = await this.storage.openReadStream(attachment.storedFilename);
    if (!opened) {
      throw new ResourceNotFoundException('Attachment');
    }

    const safeFilename = formatContentDispositionFilename(attachment.originalFilename);
    return {
      attachment,
      size: opened.size,
      stream: opened.stream,
      contentDisposition: `attachment; filename="${safeFilename}"`,
    };
  }

  public async delete(userId: string, attachmentId: string): Promise<void> {
    const removed = await this.db.withTransaction(async (tx) => {
      const deleted = await this.attachmentsRepo.deleteById(tx, userId, attachmentId);
      if (!deleted) {
        throw new ResourceNotFoundException('Attachment');
      }

      await this.auditRepo.record(tx, {
        userId,
        entityType: 'transaction_attachment',
        entityId: deleted.id,
        action: 'ATTACHMENT_DELETED',
        metadata: {
          transactionId: deleted.transactionId,
        },
      });

      return deleted;
    });

    await this.storage.delete(removed.storedFilename);
  }
}

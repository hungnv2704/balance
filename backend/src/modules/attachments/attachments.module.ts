import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { LedgerModule } from '../ledger/ledger.module';
import { AttachmentsController } from './attachments.controller';
import { ATTACHMENTS_REPOSITORY } from './attachments.repository';
import { AttachmentsService } from './attachments.service';
import {
  ATTACHMENT_STORAGE_DIR,
  DEFAULT_ATTACHMENT_STORAGE_DIR,
  LocalAttachmentStorage,
} from './local-attachment.storage';
import { PgAttachmentsRepository } from './pg-attachments.repository';

@Module({
  imports: [LedgerModule],
  controllers: [AttachmentsController],
  providers: [
    {
      provide: ATTACHMENT_STORAGE_DIR,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.attachmentStorageDir ?? DEFAULT_ATTACHMENT_STORAGE_DIR,
    },
    LocalAttachmentStorage,
    PgAttachmentsRepository,
    {
      provide: ATTACHMENTS_REPOSITORY,
      useExisting: PgAttachmentsRepository,
    },
    AttachmentsService,
  ],
  exports: [ATTACHMENTS_REPOSITORY, AttachmentsService, LocalAttachmentStorage],
})
export class AttachmentsModule {}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AttachmentDto, AttachmentListResponseDto } from '@pfm/shared-types';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { UploadAttachmentDto } from './attachments.dto';
import { AttachmentsService } from './attachments.service';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Get('transactions/:transactionId/attachments')
  public async listForTransaction(
    @CurrentUser() user: AuthenticatedUser,
    @Param('transactionId', new ParseUUIDPipe({ version: '4' })) transactionId: string,
  ): Promise<AttachmentListResponseDto> {
    return this.attachmentsService.listForTransaction(user.id, transactionId);
  }

  @Post('transactions/:transactionId/attachments')
  @HttpCode(HttpStatus.CREATED)
  public async upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('transactionId', new ParseUUIDPipe({ version: '4' })) transactionId: string,
    @Body() dto: UploadAttachmentDto,
  ): Promise<AttachmentDto> {
    return this.attachmentsService.upload(user.id, transactionId, dto);
  }

  @Get('attachments/:id/download')
  public async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const prepared = await this.attachmentsService.prepareDownload(user.id, attachmentId);

    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', prepared.attachment.mimeType);
    res.setHeader('Content-Disposition', prepared.contentDisposition);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(prepared.size));

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const fail = (err: unknown) => {
        if (!settled) {
          settled = true;
          prepared.stream.destroy();
          reject(err);
        }
      };

      prepared.stream.on('error', fail);
      res.on('finish', done);
      res.on('close', done);
      prepared.stream.pipe(res);
    });
  }

  @Delete('attachments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) attachmentId: string,
  ): Promise<void> {
    await this.attachmentsService.delete(user.id, attachmentId);
  }
}

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ImportCommitResultDto, ImportPreviewResultDto } from '@pfm/shared-types';
import { IdempotencyKeyHeader } from '../../shared-kernel/idempotency/idempotency.decorator';
import { RateLimitPolicy } from '../../shared-kernel/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../../shared-kernel/rate-limit/rate-limit.guard';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ImportCommitDto, ImportPreviewDto } from './imports.dto';
import { ImportsService } from './imports.service';

@Controller('api/v1/imports')
@UseGuards(AuthGuard)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  public async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportPreviewDto,
  ): Promise<ImportPreviewResultDto> {
    return this.importsService.preview(user.id, dto);
  }

  @Post('commit')
  @RateLimitPolicy('import')
  @UseGuards(RateLimitGuard)
  public async commit(
    @CurrentUser() user: AuthenticatedUser,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: ImportCommitDto,
  ): Promise<ImportCommitResultDto> {
    const result = await this.importsService.commit(user.id, idempotencyKey, req.path, dto);
    res.status(result.status);
    return result.body;
  }
}

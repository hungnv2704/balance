import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  CursorPaginatedResponse,
  TransferDetailDto,
  TransferStatus,
} from '@pfm/shared-types';
import { ValidationDomainException } from '../../shared-kernel/domain/domain-exceptions';
import { IdempotencyKeyHeader } from '../../shared-kernel/idempotency/idempotency.decorator';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateTransferDto, TransferLifecycleActionDto } from './transfers.dto';
import { TransfersService } from './transfers.service';

@Controller('api/v1/transfers')
@UseGuards(AuthGuard)
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Get()
  public async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('accountId') accountId?: string,
    @Query('status') status?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ): Promise<CursorPaginatedResponse<TransferDetailDto>> {
    let parsedStatus: TransferStatus | undefined;
    if (status !== undefined) {
      if (!Object.values(TransferStatus).includes(status as TransferStatus)) {
        throw new ValidationDomainException('Invalid transfer status filter.');
      }
      parsedStatus = status as TransferStatus;
    }

    const limit = limitRaw ? Number(limitRaw) : 20;

    return this.transfersService.list(user.id, {
      accountId,
      status: parsedStatus,
      fromDate,
      toDate,
      limit: Number.isFinite(limit) ? limit : 20,
      cursor,
    });
  }

  @Get(':id')
  public async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) transferId: string,
  ): Promise<TransferDetailDto> {
    return this.transfersService.getOne(user.id, transferId);
  }

  @Post()
  public async create(
    @CurrentUser() user: AuthenticatedUser,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: CreateTransferDto,
  ): Promise<TransferDetailDto> {
    const result = await this.transfersService.create(
      user.id,
      user.timezone,
      idempotencyKey,
      req.path,
      dto,
    );
    res.status(result.status);
    return result.body;
  }

  @Post(':id/void')
  public async void(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) transferId: string,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto?: TransferLifecycleActionDto,
  ): Promise<TransferDetailDto> {
    const result = await this.transfersService.void(
      user.id,
      transferId,
      idempotencyKey,
      req.path,
      dto?.reasonCode,
    );
    res.status(result.status);
    return result.body;
  }

  @Post(':id/reverse')
  public async reverse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) transferId: string,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto?: TransferLifecycleActionDto,
  ): Promise<TransferDetailDto> {
    const result = await this.transfersService.reverse(
      user.id,
      transferId,
      idempotencyKey,
      req.path,
      dto?.reasonCode,
    );
    res.status(result.status);
    return result.body;
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AccountWithBalanceDto, CursorPaginatedResponse, TransactionRecordDto } from '@pfm/shared-types';
import { IdempotencyKeyHeader } from '../../shared-kernel/idempotency/idempotency.decorator';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  ArchiveAccountDto,
  CreateAccountDto,
  CreateBalanceAdjustmentDto,
  UpdateAccountDto,
} from './accounts.dto';
import { AccountsService } from './accounts.service';

@Controller('api/v1/accounts')
@UseGuards(AuthGuard)
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  public async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<AccountWithBalanceDto[]> {
    return this.accountsService.listAccounts(user.id, includeArchived === 'true');
  }

  @Get(':id')
  public async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) accountId: string,
  ): Promise<AccountWithBalanceDto> {
    return this.accountsService.getAccount(user.id, accountId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  public async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAccountDto,
  ): Promise<AccountWithBalanceDto> {
    return this.accountsService.createAccount(user.id, user.timezone, dto);
  }

  @Patch(':id')
  public async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @Body() dto: UpdateAccountDto,
  ): Promise<AccountWithBalanceDto> {
    return this.accountsService.updateAccount(user.id, accountId, dto);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  public async archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @Body() dto?: ArchiveAccountDto,
  ): Promise<AccountWithBalanceDto> {
    return this.accountsService.archiveAccount(user.id, accountId, dto);
  }

  @Get(':id/ledger')
  public async getLedger(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ): Promise<CursorPaginatedResponse<TransactionRecordDto>> {
    const limit = limitRaw ? Number(limitRaw) : 20;
    return this.accountsService.getAccountLedger(user.id, accountId, {
      limit: Number.isFinite(limit) ? limit : 20,
      cursor,
    });
  }

  @Post(':id/adjustments')
  public async createAdjustment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: CreateBalanceAdjustmentDto,
  ): Promise<{ transaction: TransactionRecordDto; postedBalanceMinor: string }> {
    const result = await this.accountsService.createBalanceAdjustment(
      user.id,
      user.timezone,
      accountId,
      idempotencyKey,
      req.path,
      dto,
    );
    res.status(result.status);
    return result.body;
  }
}

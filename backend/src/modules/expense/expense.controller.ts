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
import {
  CursorPaginatedResponse,
  EntryType,
  ExpenseResponseDto,
  MerchantDto,
  TransactionStatus,
} from '@pfm/shared-types';
import { ValidationDomainException } from '../../shared-kernel/domain/domain-exceptions';
import { IdempotencyKeyHeader } from '../../shared-kernel/idempotency/idempotency.decorator';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  CreateExpenseDto,
  CreateExpenseRefundDto,
  CreateMerchantDto,
  ExpenseLifecycleActionDto,
  UpdateExpenseDto,
} from './expense.dto';
import { ExpenseService } from './expense.service';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class ExpenseController {
  constructor(private readonly expenseService: ExpenseService) {}

  @Get('expenses')
  public async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('entryType') entryType?: string,
    @Query('accountId') accountId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('merchantId') merchantId?: string,
    @Query('status') status?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ): Promise<CursorPaginatedResponse<ExpenseResponseDto>> {
    let parsedEntryType: EntryType.EXPENSE | EntryType.EXPENSE_REFUND | undefined;
    if (entryType !== undefined) {
      if (entryType !== EntryType.EXPENSE && entryType !== EntryType.EXPENSE_REFUND) {
        throw new ValidationDomainException(
          "Query param 'entryType' must be EXPENSE or EXPENSE_REFUND.",
        );
      }
      parsedEntryType = entryType;
    }

    let parsedStatus: TransactionStatus | undefined;
    if (status !== undefined) {
      if (!Object.values(TransactionStatus).includes(status as TransactionStatus)) {
        throw new ValidationDomainException('Invalid transaction status filter.');
      }
      parsedStatus = status as TransactionStatus;
    }

    const limit = limitRaw ? Number(limitRaw) : 20;

    return this.expenseService.list(user.id, {
      entryType: parsedEntryType,
      accountId,
      categoryId,
      merchantId,
      status: parsedStatus,
      fromDate,
      toDate,
      limit: Number.isFinite(limit) ? limit : 20,
      cursor,
    });
  }

  @Get('expenses/:id')
  public async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) expenseId: string,
  ): Promise<ExpenseResponseDto> {
    return this.expenseService.getOne(user.id, expenseId);
  }

  @Post('expenses')
  public async create(
    @CurrentUser() user: AuthenticatedUser,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: CreateExpenseDto,
  ): Promise<ExpenseResponseDto> {
    const result = await this.expenseService.create(
      user.id,
      user.timezone,
      idempotencyKey,
      req.path,
      dto,
    );
    res.status(result.status);
    return result.body;
  }

  @Patch('expenses/:id')
  public async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) expenseId: string,
    @Body() dto: UpdateExpenseDto,
  ): Promise<ExpenseResponseDto> {
    return this.expenseService.update(user.id, expenseId, dto);
  }

  @Post('expenses/:id/post')
  public async post(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) expenseId: string,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ExpenseResponseDto> {
    const result = await this.expenseService.post(user.id, expenseId, idempotencyKey, req.path);
    res.status(result.status);
    return result.body;
  }

  @Post('expenses/:id/void')
  public async void(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) expenseId: string,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto?: ExpenseLifecycleActionDto,
  ): Promise<ExpenseResponseDto> {
    const result = await this.expenseService.void(
      user.id,
      expenseId,
      idempotencyKey,
      req.path,
      dto?.reasonCode,
    );
    res.status(result.status);
    return result.body;
  }

  @Post('expenses/:id/reverse')
  public async reverse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) expenseId: string,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto?: ExpenseLifecycleActionDto,
  ): Promise<ExpenseResponseDto> {
    const result = await this.expenseService.reverse(
      user.id,
      expenseId,
      idempotencyKey,
      req.path,
      dto?.reasonCode,
    );
    res.status(result.status);
    return result.body;
  }

  @Post('expenses/:id/refunds')
  public async createRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) expenseId: string,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: CreateExpenseRefundDto,
  ): Promise<ExpenseResponseDto> {
    const result = await this.expenseService.createRefund(
      user.id,
      user.timezone,
      expenseId,
      idempotencyKey,
      req.path,
      dto,
    );
    res.status(result.status);
    return result.body;
  }

  @Get('merchants')
  public async listMerchants(@CurrentUser() user: AuthenticatedUser): Promise<MerchantDto[]> {
    return this.expenseService.listMerchants(user.id);
  }

  @Post('merchants')
  @HttpCode(HttpStatus.CREATED)
  public async createMerchant(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMerchantDto,
  ): Promise<MerchantDto> {
    return this.expenseService.createMerchant(user.id, dto);
  }
}

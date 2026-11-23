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
  IncomeResponseDto,
  IncomeSourceDto,
  TransactionStatus,
} from '@pfm/shared-types';
import { ValidationDomainException } from '../../shared-kernel/domain/domain-exceptions';
import { IdempotencyKeyHeader } from '../../shared-kernel/idempotency/idempotency.decorator';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  CreateIncomeDto,
  CreateIncomeSourceDto,
  IncomeLifecycleActionDto,
  UpdateIncomeDto,
} from './income.dto';
import { IncomeService } from './income.service';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class IncomeController {
  constructor(private readonly incomeService: IncomeService) {}

  @Get('incomes')
  public async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('accountId') accountId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('incomeSourceId') incomeSourceId?: string,
    @Query('status') status?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ): Promise<CursorPaginatedResponse<IncomeResponseDto>> {
    let parsedStatus: TransactionStatus | undefined;
    if (status !== undefined) {
      if (!Object.values(TransactionStatus).includes(status as TransactionStatus)) {
        throw new ValidationDomainException('Invalid transaction status filter.');
      }
      parsedStatus = status as TransactionStatus;
    }

    const limit = limitRaw ? Number(limitRaw) : 20;

    return this.incomeService.list(user.id, {
      accountId,
      categoryId,
      incomeSourceId,
      status: parsedStatus,
      fromDate,
      toDate,
      limit: Number.isFinite(limit) ? limit : 20,
      cursor,
    });
  }

  @Get('incomes/:id')
  public async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) incomeId: string,
  ): Promise<IncomeResponseDto> {
    return this.incomeService.getOne(user.id, incomeId);
  }

  @Post('incomes')
  public async create(
    @CurrentUser() user: AuthenticatedUser,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: CreateIncomeDto,
  ): Promise<IncomeResponseDto> {
    const result = await this.incomeService.create(
      user.id,
      user.timezone,
      idempotencyKey,
      req.path,
      dto,
    );
    res.status(result.status);
    return result.body;
  }

  @Patch('incomes/:id')
  public async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) incomeId: string,
    @Body() dto: UpdateIncomeDto,
  ): Promise<IncomeResponseDto> {
    return this.incomeService.update(user.id, incomeId, dto);
  }

  @Post('incomes/:id/post')
  public async post(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) incomeId: string,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<IncomeResponseDto> {
    const result = await this.incomeService.post(user.id, incomeId, idempotencyKey, req.path);
    res.status(result.status);
    return result.body;
  }

  @Post('incomes/:id/void')
  public async void(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) incomeId: string,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto?: IncomeLifecycleActionDto,
  ): Promise<IncomeResponseDto> {
    const result = await this.incomeService.void(
      user.id,
      incomeId,
      idempotencyKey,
      req.path,
      dto?.reasonCode,
    );
    res.status(result.status);
    return result.body;
  }

  @Post('incomes/:id/reverse')
  public async reverse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) incomeId: string,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto?: IncomeLifecycleActionDto,
  ): Promise<IncomeResponseDto> {
    const result = await this.incomeService.reverse(
      user.id,
      incomeId,
      idempotencyKey,
      req.path,
      dto?.reasonCode,
    );
    res.status(result.status);
    return result.body;
  }

  @Get('income-sources')
  public async listSources(@CurrentUser() user: AuthenticatedUser): Promise<IncomeSourceDto[]> {
    return this.incomeService.listSources(user.id);
  }

  @Post('income-sources')
  @HttpCode(HttpStatus.CREATED)
  public async createSource(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateIncomeSourceDto,
  ): Promise<IncomeSourceDto> {
    return this.incomeService.createSource(user.id, dto);
  }
}

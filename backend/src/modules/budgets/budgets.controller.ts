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
  UseGuards,
} from '@nestjs/common';
import { BudgetDto } from '@pfm/shared-types';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateBudgetDto, UpdateBudgetDto } from './budgets.dto';
import { BudgetsService } from './budgets.service';

@Controller('api/v1/budgets')
@UseGuards(AuthGuard)
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get()
  public async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('currency') currency?: string,
    @Query('month') month?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('categoryId') categoryId?: string,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<BudgetDto[]> {
    return this.budgetsService.list(user.id, {
      currency,
      month,
      fromDate,
      toDate,
      categoryId,
      includeArchived: includeArchived === 'true',
    });
  }

  @Get(':id')
  public async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) budgetId: string,
  ): Promise<BudgetDto> {
    return this.budgetsService.getOne(user.id, budgetId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  public async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBudgetDto,
  ): Promise<BudgetDto> {
    return this.budgetsService.create(user.id, user.timezone, dto);
  }

  @Patch(':id')
  public async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) budgetId: string,
    @Body() dto: UpdateBudgetDto,
  ): Promise<BudgetDto> {
    return this.budgetsService.update(user.id, budgetId, dto);
  }
}

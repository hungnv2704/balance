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
  CategoryKind,
  RecurringRuleDto,
  RunDueRecurringResultDto,
} from '@pfm/shared-types';
import { ValidationDomainException } from '../../shared-kernel/domain/domain-exceptions';
import { IdempotencyKeyHeader } from '../../shared-kernel/idempotency/idempotency.decorator';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  CreateRecurringRuleDto,
  RunDueRecurringDto,
  UpdateRecurringRuleDto,
} from './recurring.dto';
import { RecurringService } from './recurring.service';

@Controller('api/v1/recurring-rules')
@UseGuards(AuthGuard)
export class RecurringController {
  constructor(private readonly recurringService: RecurringService) {}

  @Get()
  public async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('ruleKind') ruleKind?: string,
    @Query('isActive') isActive?: string,
  ): Promise<{ items: RecurringRuleDto[] }> {
    let parsedRuleKind: CategoryKind | undefined;
    if (ruleKind !== undefined) {
      if (ruleKind !== CategoryKind.INCOME && ruleKind !== CategoryKind.EXPENSE) {
        throw new ValidationDomainException(
          'Invalid ruleKind filter. Expected INCOME or EXPENSE.',
          'INVALID_RULE_KIND',
        );
      }
      parsedRuleKind = ruleKind;
    }

    let parsedIsActive: boolean | undefined;
    if (isActive !== undefined) {
      if (isActive !== 'true' && isActive !== 'false') {
        throw new ValidationDomainException(
          'Invalid isActive filter. Expected true or false.',
          'INVALID_BOOLEAN_FILTER',
        );
      }
      parsedIsActive = isActive === 'true';
    }

    return this.recurringService.list(user.id, {
      ruleKind: parsedRuleKind,
      isActive: parsedIsActive,
    });
  }

  @Post('run-due')
  public async runDue(
    @CurrentUser() user: AuthenticatedUser,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto?: RunDueRecurringDto,
  ): Promise<RunDueRecurringResultDto> {
    const result = await this.recurringService.runDue(
      user.id,
      user.timezone,
      idempotencyKey,
      req.path,
      dto,
    );
    res.status(result.status);
    return result.body;
  }

  @Get(':id')
  public async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) ruleId: string,
  ): Promise<RecurringRuleDto> {
    return this.recurringService.getOne(user.id, ruleId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  public async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRecurringRuleDto,
  ): Promise<RecurringRuleDto> {
    return this.recurringService.create(user.id, user.timezone, dto);
  }

  @Patch(':id')
  public async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) ruleId: string,
    @Body() dto: UpdateRecurringRuleDto,
  ): Promise<RecurringRuleDto> {
    return this.recurringService.update(user.id, ruleId, dto);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  public async pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) ruleId: string,
  ): Promise<RecurringRuleDto> {
    return this.recurringService.pause(user.id, ruleId);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  public async resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) ruleId: string,
  ): Promise<RecurringRuleDto> {
    return this.recurringService.resume(user.id, ruleId);
  }
}

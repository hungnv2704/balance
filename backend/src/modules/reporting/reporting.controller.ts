import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { BalancesReportDto, CashFlowReportDto } from '@pfm/shared-types';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ReportingService } from './reporting.service';

@Controller('api/v1/reports')
@UseGuards(AuthGuard)
export class ReportingController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get('balances')
  public async balances(
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeArchived') includeArchived?: string,
    @Query('currency') currency?: string,
  ): Promise<BalancesReportDto> {
    return this.reportingService.getBalancesReport(user.id, user.baseCurrencyCode, {
      includeArchived: includeArchived === 'true',
      currency,
    });
  }

  @Get('cash-flow')
  public async cashFlow(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('currency') currency?: string,
    @Query('accountId') accountId?: string,
  ): Promise<CashFlowReportDto> {
    return this.reportingService.getCashFlowReport(
      user.id,
      user.timezone,
      user.baseCurrencyCode,
      { from, to, currency, accountId },
    );
  }
}

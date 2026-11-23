import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AccountDeletionScheduledResponseDto } from '@pfm/shared-types';
import { RateLimitPolicy } from '../../shared-kernel/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../../shared-kernel/rate-limit/rate-limit.guard';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../auth/token.service';
import { CreateExportDto, ScheduleAccountDeletionDto } from './data-ops.dto';
import { DataOpsService } from './data-ops.service';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class DataOpsController {
  constructor(private readonly dataOpsService: DataOpsService) {}

  @Post('exports')
  @RateLimitPolicy('export')
  @UseGuards(RateLimitGuard)
  public async exportData(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateExportDto,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.dataOpsService.exportUserData(user.id, dto);

    res.status(HttpStatus.OK);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Content-Type', result.contentType);

    if (result.format === 'CSV') {
      res.send(result.csv);
      return;
    }

    res.json(result.data);
  }

  @Delete('users/me')
  @HttpCode(HttpStatus.OK)
  public async deleteMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ScheduleAccountDeletionDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccountDeletionScheduledResponseDto> {
    const result = await this.dataOpsService.scheduleAccountDeletion(user.id, dto);
    res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/api/v1/auth' });
    return result;
  }
}

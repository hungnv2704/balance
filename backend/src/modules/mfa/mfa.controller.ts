import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  MfaDisableResponseDto,
  MfaSetupResponseDto,
  MfaStatusDto,
  MfaVerifyResponseDto,
} from '@pfm/shared-types';
import { RateLimitPolicy } from '../../shared-kernel/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../../shared-kernel/rate-limit/rate-limit.guard';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { DisableMfaDto, VerifyMfaDto } from './mfa.dto';
import { MfaService } from './mfa.service';

@Controller('api/v1/auth/mfa')
@UseGuards(AuthGuard)
export class MfaController {
  constructor(private readonly mfaService: MfaService) {}

  @Get('status')
  public async status(@CurrentUser() user: AuthenticatedUser): Promise<MfaStatusDto> {
    return this.mfaService.getStatus(user.id);
  }

  @Post('setup')
  @HttpCode(HttpStatus.OK)
  public async setup(@CurrentUser() user: AuthenticatedUser): Promise<MfaSetupResponseDto> {
    return this.mfaService.setup(user.id);
  }

  @Post('verify')
  @RateLimitPolicy('auth')
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  public async verify(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifyMfaDto,
  ): Promise<MfaVerifyResponseDto> {
    return this.mfaService.verifyAndEnable(user.id, dto.code);
  }

  @Post('disable')
  @RateLimitPolicy('auth')
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  public async disable(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DisableMfaDto,
  ): Promise<MfaDisableResponseDto> {
    return this.mfaService.disable(user.id, dto.password, dto.code);
  }
}

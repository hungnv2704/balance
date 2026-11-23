import { Controller, Get } from '@nestjs/common';
import { SUPPORTED_CURRENCY_CODES } from '@pfm/shared-types';

@Controller('api/v1/health')
export class HealthController {
  @Get()
  public check(): { status: string; supportedCurrencies: readonly string[] } {
    return {
      status: 'ok',
      supportedCurrencies: SUPPORTED_CURRENCY_CODES,
    };
  }
}

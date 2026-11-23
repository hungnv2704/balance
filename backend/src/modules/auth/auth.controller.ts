import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthResponseDto, UserProfileDto } from '@pfm/shared-types';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { RateLimitPolicy } from '../../shared-kernel/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../../shared-kernel/rate-limit/rate-limit.guard';
import { LoginDto, RefreshTokenDto, RegisterDto, UpdatePreferencesDto } from './auth.dto';
import { AuthGuard } from './auth.guard';
import { AuthenticatedUser } from './auth.types';
import { AuthService, AuthTokenResult } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './token.service';

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('register')
  @RateLimitPolicy('auth')
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.CREATED)
  public async register(
    @Body() dto: RegisterDto,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.register(dto, userAgent);
    this.setAuthCookies(res, result);
    return result.response;
  }

  @Post('login')
  @RateLimitPolicy('auth')
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  public async login(
    @Body() dto: LoginDto,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.login(dto, userAgent);
    this.setAuthCookies(res, result);
    return result.response;
  }

  @Post('refresh')
  @RateLimitPolicy('auth')
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  public async refresh(
    @Req() req: Request,
    @Body() dto: RefreshTokenDto,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const rawRefreshToken = cookies?.[REFRESH_TOKEN_COOKIE] ?? dto?.refreshToken;
    const result = await this.authService.refresh(rawRefreshToken, userAgent);
    this.setAuthCookies(res, result);
    return result.response;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async logout(
    @Req() req: Request,
    @Body() dto: RefreshTokenDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const rawRefreshToken = cookies?.[REFRESH_TOKEN_COOKIE] ?? dto?.refreshToken;
    await this.authService.logout(rawRefreshToken);
    this.clearAuthCookies(res);
  }

  @Post('logout-all')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  public async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logoutAll(user.id);
    this.clearAuthCookies(res);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  public async me(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ user: UserProfileDto; activeAccountCount: number }> {
    return this.authService.getProfile(user.id);
  }

  @Patch('preferences')
  @UseGuards(AuthGuard)
  public async updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<UserProfileDto> {
    return this.authService.updatePreferences(user.id, dto);
  }

  private setAuthCookies(res: Response, result: AuthTokenResult): void {
    res.cookie(ACCESS_TOKEN_COOKIE, result.response.accessToken, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: this.config.cookieSameSite,
      maxAge: result.response.expiresInSeconds * 1000,
      path: '/',
    });
    res.cookie(REFRESH_TOKEN_COOKIE, result.rawRefreshToken, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: this.config.cookieSameSite,
      maxAge: this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth',
    });
  }

  private clearAuthCookies(res: Response): void {
    res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/api/v1/auth' });
  }
}

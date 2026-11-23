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
import { CategoryDto, CategoryKind } from '@pfm/shared-types';
import { ValidationDomainException } from '../../shared-kernel/domain/domain-exceptions';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateCategoryDto, UpdateCategoryDto } from './categories.dto';
import { CategoriesService } from './categories.service';

@Controller('api/v1/categories')
@UseGuards(AuthGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  public async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('kind') kind?: string,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<CategoryDto[]> {
    let parsedKind: CategoryKind | undefined;
    if (kind !== undefined) {
      if (kind !== CategoryKind.INCOME && kind !== CategoryKind.EXPENSE) {
        throw new ValidationDomainException("Query param 'kind' must be INCOME or EXPENSE.");
      }
      parsedKind = kind;
    }

    return this.categoriesService.list(user.id, parsedKind, includeArchived === 'true');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  public async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCategoryDto,
  ): Promise<CategoryDto> {
    return this.categoriesService.create(user.id, dto);
  }

  @Patch(':id')
  public async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryDto> {
    return this.categoriesService.update(user.id, categoryId, dto);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  public async archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) categoryId: string,
  ): Promise<CategoryDto> {
    return this.categoriesService.archive(user.id, categoryId);
  }
}

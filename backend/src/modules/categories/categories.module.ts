import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CATEGORIES_REPOSITORY } from './categories.repository';
import { CategoriesService } from './categories.service';
import { PgCategoriesRepository } from './pg-categories.repository';

@Module({
  controllers: [CategoriesController],
  providers: [
    PgCategoriesRepository,
    {
      provide: CATEGORIES_REPOSITORY,
      useExisting: PgCategoriesRepository,
    },
    CategoriesService,
  ],
  exports: [CATEGORIES_REPOSITORY, CategoriesService],
})
export class CategoriesModule {}

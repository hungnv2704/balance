import { Inject, Injectable } from '@nestjs/common';
import { CategoryDto, CategoryKind } from '@pfm/shared-types';
import { DATABASE_EXECUTOR, DatabaseExecutor } from '../../database/database.types';
import {
  InvalidStateTransitionException,
  ResourceNotFoundException,
  ValidationDomainException,
} from '../../shared-kernel/domain/domain-exceptions';
import { AUDIT_REPOSITORY, AuditRepository } from '../audit/audit.repository';
import { CreateCategoryDto, UpdateCategoryDto } from './categories.dto';
import { CATEGORIES_REPOSITORY, CategoriesRepository } from './categories.repository';
import { CategoryEntity, toCategoryDto } from './categories.types';

@Injectable()
export class CategoriesService {
  constructor(
    @Inject(DATABASE_EXECUTOR) private readonly db: DatabaseExecutor,
    @Inject(CATEGORIES_REPOSITORY) private readonly categoriesRepo: CategoriesRepository,
    @Inject(AUDIT_REPOSITORY) private readonly auditRepo: AuditRepository,
  ) {}

  public async list(
    userId: string,
    kind?: CategoryKind,
    includeArchived = false,
  ): Promise<CategoryDto[]> {
    const categories = await this.categoriesRepo.list(this.db, userId, kind, includeArchived);
    return categories.map(toCategoryDto);
  }

  public async create(userId: string, dto: CreateCategoryDto): Promise<CategoryDto> {
    const trimmedName = dto.name.trim();
    if (trimmedName.length === 0) {
      throw new ValidationDomainException('Category name cannot be empty.');
    }

    const created = await this.db.withTransaction(async (tx) => {
      if (dto.parentId) {
        const parent = await this.categoriesRepo.findById(tx, userId, dto.parentId);
        if (!parent) {
          throw new ResourceNotFoundException('Parent category');
        }
        if (parent.kind !== dto.kind) {
          throw new ValidationDomainException(
            'Parent category kind must match child category kind.',
            'CATEGORY_KIND_MISMATCH',
          );
        }
        if (parent.archivedAt !== null) {
          throw new InvalidStateTransitionException(
            'Cannot create a subcategory under an archived parent category.',
          );
        }
      }

      const category = await this.categoriesRepo.create(tx, {
        userId,
        kind: dto.kind,
        name: trimmedName,
        parentId: dto.parentId ?? null,
      });

      await this.auditRepo.record(tx, {
        userId,
        entityType: 'category',
        entityId: category.id,
        action: 'CATEGORY_CREATED',
        metadata: { kind: category.kind },
      });

      return category;
    });

    return toCategoryDto(created);
  }

  public async update(
    userId: string,
    categoryId: string,
    dto: UpdateCategoryDto,
  ): Promise<CategoryDto> {
    const trimmedName = dto.name.trim();
    if (trimmedName.length === 0) {
      throw new ValidationDomainException('Category name cannot be empty.');
    }

    const updated = await this.db.withTransaction(async (tx) => {
      const existing = await this.categoriesRepo.findById(tx, userId, categoryId);
      if (!existing) {
        throw new ResourceNotFoundException('Category');
      }
      if (existing.archivedAt !== null) {
        throw new InvalidStateTransitionException('Cannot rename an archived category.');
      }
      return this.categoriesRepo.updateName(tx, userId, categoryId, trimmedName);
    });

    return toCategoryDto(updated);
  }

  public async archive(userId: string, categoryId: string): Promise<CategoryDto> {
    const archived = await this.db.withTransaction(async (tx) => {
      const existing = await this.categoriesRepo.findById(tx, userId, categoryId);
      if (!existing) {
        throw new ResourceNotFoundException('Category');
      }
      if (existing.archivedAt !== null) {
        return existing;
      }

      const result = await this.categoriesRepo.archive(tx, userId, categoryId);
      await this.auditRepo.record(tx, {
        userId,
        entityType: 'category',
        entityId: categoryId,
        action: 'CATEGORY_ARCHIVED',
        metadata: { kind: existing.kind },
      });
      return result;
    });

    return toCategoryDto(archived);
  }

  /**
   * Authoritative category verification used by Income & Expense modules
   * to prevent cross-tenant assignment and INCOME/EXPENSE category mixing.
   */
  public async assertActiveCategoryForKind(
    userId: string,
    categoryId: string,
    expectedKind: CategoryKind,
    db = this.db as unknown as import('../../database/database.types').DbQueryClient,
  ): Promise<CategoryEntity> {
    const category = await this.categoriesRepo.findById(db, userId, categoryId);
    if (!category) {
      throw new ResourceNotFoundException('Category');
    }
    if (category.kind !== expectedKind) {
      throw new ValidationDomainException(
        `Category must be of kind '${expectedKind}', received '${category.kind}'.`,
        'CATEGORY_KIND_MISMATCH',
      );
    }
    if (category.archivedAt !== null) {
      throw new InvalidStateTransitionException(
        'Cannot record new transactions under an archived category.',
        'CATEGORY_ARCHIVED',
      );
    }
    return category;
  }
}

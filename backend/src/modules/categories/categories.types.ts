import { CategoryDto, CategoryKind } from '@pfm/shared-types';

export interface CategoryEntity {
  readonly id: string;
  readonly userId: string;
  readonly kind: CategoryKind;
  readonly name: string;
  readonly parentId: string | null;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
}

export function toCategoryDto(entity: CategoryEntity): CategoryDto {
  return {
    id: entity.id,
    kind: entity.kind,
    name: entity.name,
    parentId: entity.parentId,
    archivedAt: entity.archivedAt ? entity.archivedAt.toISOString() : null,
    createdAt: entity.createdAt.toISOString(),
  };
}

import { Inject, Injectable } from '@nestjs/common';
import {
  CategoryKind,
  EntryType,
  ImportCommitResultDto,
  ImportEntryType,
  ImportPreviewResultDto,
  ImportPreviewRowDto,
  TransactionStatus,
} from '@pfm/shared-types';
import { DATABASE_EXECUTOR, DatabaseExecutor } from '../../database/database.types';
import { assertValidLocalDate } from '../../shared-kernel/domain/date-time';
import { ValidationDomainException } from '../../shared-kernel/domain/domain-exceptions';
import { Money } from '../../shared-kernel/domain/money';
import { IdempotencyService } from '../../shared-kernel/idempotency/idempotency.service';
import { DefaultAccountResolver } from '../accounts/default-account.resolver';
import { AUDIT_REPOSITORY, AuditRepository } from '../audit/audit.repository';
import { CATEGORIES_REPOSITORY, CategoriesRepository } from '../categories/categories.repository';
import { CategoriesService } from '../categories/categories.service';
import { CategoryEntity } from '../categories/categories.types';
import {
  MERCHANTS_REPOSITORY,
  MerchantEntity,
  MerchantsRepository,
} from '../expense/merchants.repository';
import {
  INCOME_SOURCES_REPOSITORY,
  IncomeSourceEntity,
  IncomeSourcesRepository,
} from '../income/income-sources.repository';
import { LEDGER_REPOSITORY, LedgerRepository } from '../ledger/ledger.repository';
import { MAX_IMPORT_ROWS, parseImportCsv } from './csv-parser';
import { ImportCommitDto, ImportPreviewDto } from './imports.dto';

const UUID_V4_OR_ANY_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_DESCRIPTION_LENGTH = 255;
const MAX_COUNTERPARTY_LENGTH = 100;

interface ValidatedPreviewCandidate {
  readonly rowNumber: number;
  readonly entryType: ImportEntryType | null;
  readonly transactionDate: string | null;
  readonly amountMinor: string | null;
  readonly categoryName: string | null;
  readonly categoryId: string | null;
  readonly description: string | null;
  readonly counterparty: string | null;
  readonly errors: string[];
}

function buildDuplicateFingerprint(
  transactionDate: string,
  amountMinor: string,
  entryType: ImportEntryType,
): string {
  return `${transactionDate}|${amountMinor}|${entryType}`;
}

@Injectable()
export class ImportsService {
  constructor(
    @Inject(DATABASE_EXECUTOR) private readonly db: DatabaseExecutor,
    @Inject(CATEGORIES_REPOSITORY) private readonly categoriesRepo: CategoriesRepository,
    @Inject(LEDGER_REPOSITORY) private readonly ledgerRepo: LedgerRepository,
    @Inject(INCOME_SOURCES_REPOSITORY) private readonly incomeSourcesRepo: IncomeSourcesRepository,
    @Inject(MERCHANTS_REPOSITORY) private readonly merchantsRepo: MerchantsRepository,
    @Inject(AUDIT_REPOSITORY) private readonly auditRepo: AuditRepository,
    private readonly defaultAccountResolver: DefaultAccountResolver,
    private readonly categoriesService: CategoriesService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  public async preview(userId: string, dto: ImportPreviewDto): Promise<ImportPreviewResultDto> {
    const parsedRows = parseImportCsv(dto.csvContent);

    const account = await this.defaultAccountResolver.resolveForTransaction(
      this.db,
      userId,
      dto.accountId,
    );

    const activeCategories = await this.categoriesRepo.list(this.db, userId, undefined, false);
    const categoriesByKindAndName = new Map<string, CategoryEntity>();
    const categoryKindsByName = new Map<string, Set<CategoryKind>>();

    for (const cat of activeCategories) {
      const lowerName = cat.name.trim().toLowerCase();
      categoriesByKindAndName.set(`${cat.kind}:${lowerName}`, cat);
      const kinds = categoryKindsByName.get(lowerName) ?? new Set<CategoryKind>();
      kinds.add(cat.kind);
      categoryKindsByName.set(lowerName, kinds);
    }

    const candidates: ValidatedPreviewCandidate[] = [];
    const validDates: string[] = [];

    for (const rawRow of parsedRows) {
      const errors: string[] = [];

      if (rawRow.extraColumnsError) {
        errors.push(rawRow.extraColumnsError);
      }

      // 1. Validate entryType
      let entryType: ImportEntryType | null = null;
      const upperType = rawRow.rawType.toUpperCase();
      if (rawRow.rawType.length === 0) {
        errors.push("Missing entry type; expected 'INCOME' or 'EXPENSE'.");
      } else if (upperType === 'INCOME' || upperType === 'EXPENSE') {
        entryType = upperType;
      } else {
        errors.push(`Invalid entry type '${rawRow.rawType}'; expected 'INCOME' or 'EXPENSE'.`);
      }

      // 2. Validate transactionDate (YYYY-MM-DD)
      let transactionDate: string | null = null;
      if (rawRow.rawDate.length === 0) {
        errors.push('Missing transaction date; expected YYYY-MM-DD.');
      } else {
        try {
          transactionDate = assertValidLocalDate(rawRow.rawDate);
        } catch (err) {
          errors.push(
            err instanceof Error ? err.message : `Invalid transaction date '${rawRow.rawDate}'.`,
          );
        }
      }

      // 3. Validate amount using Money.parseDecimal against account currency minor_unit
      let amountMinor: string | null = null;
      if (rawRow.rawAmount.length === 0) {
        errors.push('Missing amount.');
      } else {
        try {
          const parsedMoney = Money.parseDecimal(rawRow.rawAmount, account.currencyCode, {
            allowZero: false,
            allowNegative: false,
          });
          amountMinor = parsedMoney.toMinorString();
        } catch (err) {
          errors.push(
            err instanceof Error ? err.message : `Invalid monetary amount '${rawRow.rawAmount}'.`,
          );
        }
      }

      // 4. Resolve active category matching entryType kind
      const categoryName = rawRow.rawCategory.length > 0 ? rawRow.rawCategory : null;
      let categoryId: string | null = null;
      if (categoryName === null) {
        errors.push('Missing category name.');
      } else if (entryType !== null) {
        const expectedKind =
          entryType === 'INCOME' ? CategoryKind.INCOME : CategoryKind.EXPENSE;
        const lowerName = categoryName.toLowerCase();
        const matched = categoriesByKindAndName.get(`${expectedKind}:${lowerName}`);
        if (matched) {
          categoryId = matched.id;
        } else {
          const otherKinds = categoryKindsByName.get(lowerName);
          if (otherKinds && otherKinds.size > 0) {
            errors.push(
              `Category '${categoryName}' does not match entry type '${entryType}'.`,
            );
          } else {
            errors.push(
              `Unknown active ${entryType} category '${categoryName}'.`,
            );
          }
        }
      }

      // 5. Validate optional description & counterparty lengths against PostgreSQL schema limits
      const description = rawRow.rawDescription.length > 0 ? rawRow.rawDescription : null;
      if (description !== null && description.length > MAX_DESCRIPTION_LENGTH) {
        errors.push(
          `Description exceeds maximum length of ${MAX_DESCRIPTION_LENGTH} characters.`,
        );
      }

      const counterparty = rawRow.rawCounterparty.length > 0 ? rawRow.rawCounterparty : null;
      if (counterparty !== null && counterparty.length > MAX_COUNTERPARTY_LENGTH) {
        errors.push(
          `Counterparty exceeds maximum length of ${MAX_COUNTERPARTY_LENGTH} characters.`,
        );
      }

      if (errors.length === 0 && transactionDate !== null) {
        validDates.push(transactionDate);
      }

      candidates.push({
        rowNumber: rawRow.rowNumber,
        entryType,
        transactionDate,
        amountMinor,
        categoryName,
        categoryId,
        description,
        counterparty,
        errors,
      });
    }

    const dbDuplicateKeys = new Set<string>();
    if (validDates.length > 0) {
      let minDate = validDates[0];
      let maxDate = validDates[0];
      for (const dt of validDates) {
        if (dt < minDate) minDate = dt;
        if (dt > maxDate) maxDate = dt;
      }

      const existingCandidates = await this.ledgerRepo.findActiveDuplicateCandidates(this.db, {
        userId,
        accountId: account.id,
        entryTypes: [EntryType.INCOME, EntryType.EXPENSE],
        minDate,
        maxDate,
      });

      for (const item of existingCandidates) {
        if (item.entryType === EntryType.INCOME || item.entryType === EntryType.EXPENSE) {
          dbDuplicateKeys.add(
            buildDuplicateFingerprint(
              item.transactionDate,
              item.amountMinor.toString(),
              item.entryType,
            ),
          );
        }
      }
    }

    const seenFileRows = new Map<string, number>();
    let validRows = 0;
    let duplicateRows = 0;
    let invalidRows = 0;

    const rows: ImportPreviewRowDto[] = candidates.map((candidate) => {
      if (
        candidate.errors.length > 0 ||
        candidate.entryType === null ||
        candidate.transactionDate === null ||
        candidate.amountMinor === null
      ) {
        invalidRows += 1;
        return {
          rowNumber: candidate.rowNumber,
          entryType: candidate.entryType,
          transactionDate: candidate.transactionDate,
          amountMinor: candidate.amountMinor,
          currencyCode: account.currencyCode,
          categoryName: candidate.categoryName,
          categoryId: candidate.categoryId,
          description: candidate.description,
          counterparty: candidate.counterparty,
          status: 'INVALID',
          duplicateReason: null,
          errors: candidate.errors,
        };
      }

      const fingerprint = buildDuplicateFingerprint(
        candidate.transactionDate,
        candidate.amountMinor,
        candidate.entryType,
      );
      const matchesDb = dbDuplicateKeys.has(fingerprint);
      const firstFileRow = seenFileRows.get(fingerprint);

      if (firstFileRow === undefined) {
        seenFileRows.set(fingerprint, candidate.rowNumber);
      }

      if (matchesDb || firstFileRow !== undefined) {
        duplicateRows += 1;
        const decimalDisplay = Money.fromMinor(
          candidate.amountMinor,
          account.currencyCode,
        ).toDecimalString();

        let duplicateReason: string;
        if (matchesDb && firstFileRow !== undefined) {
          duplicateReason = `Matches existing non-voided transaction in account (${candidate.transactionDate}, ${candidate.entryType}, ${decimalDisplay} ${account.currencyCode}) and duplicates CSV row ${firstFileRow}.`;
        } else if (matchesDb) {
          duplicateReason = `Matches existing non-voided transaction in account (${candidate.transactionDate}, ${candidate.entryType}, ${decimalDisplay} ${account.currencyCode}).`;
        } else {
          duplicateReason = `Duplicate of CSV row ${firstFileRow} (${candidate.transactionDate}, ${candidate.entryType}, ${decimalDisplay} ${account.currencyCode}).`;
        }

        return {
          rowNumber: candidate.rowNumber,
          entryType: candidate.entryType,
          transactionDate: candidate.transactionDate,
          amountMinor: candidate.amountMinor,
          currencyCode: account.currencyCode,
          categoryName: candidate.categoryName,
          categoryId: candidate.categoryId,
          description: candidate.description,
          counterparty: candidate.counterparty,
          status: 'DUPLICATE_SUSPECTED',
          duplicateReason,
          errors: [],
        };
      }

      validRows += 1;
      return {
        rowNumber: candidate.rowNumber,
        entryType: candidate.entryType,
        transactionDate: candidate.transactionDate,
        amountMinor: candidate.amountMinor,
        currencyCode: account.currencyCode,
        categoryName: candidate.categoryName,
        categoryId: candidate.categoryId,
        description: candidate.description,
        counterparty: candidate.counterparty,
        status: 'VALID',
        duplicateReason: null,
        errors: [],
      };
    });

    return {
      accountId: account.id,
      currencyCode: account.currencyCode,
      totalRows: rows.length,
      validRows,
      duplicateRows,
      invalidRows,
      rows,
    };
  }

  public async commit(
    userId: string,
    idempotencyKey: string | undefined,
    requestPath: string,
    dto: ImportCommitDto,
  ): Promise<{ status: number; body: ImportCommitResultDto }> {
    if (!Array.isArray(dto.rows) || dto.rows.length === 0) {
      throw new ValidationDomainException(
        'At least one row is required to commit an import.',
        'EMPTY_IMPORT_ROWS',
      );
    }

    if (dto.rows.length > MAX_IMPORT_ROWS) {
      throw new ValidationDomainException(
        `Bulk import cannot exceed ${MAX_IMPORT_ROWS} rows.`,
        'IMPORT_ROW_LIMIT_EXCEEDED',
      );
    }

    return this.db.withTransaction(async (tx) => {
      const exec = await this.idempotencyService.execute<ImportCommitResultDto>(
        tx,
        {
          userId,
          idempotencyKey,
          method: 'POST',
          path: requestPath,
          payload: dto,
        },
        async () => {
          const account = await this.defaultAccountResolver.resolveForTransaction(
            tx,
            userId,
            dto.accountId,
          );

          const validatedCategories = new Map<string, CategoryEntity>();
          let merchantsByLowerName: Map<string, MerchantEntity> | null = null;
          let incomeSourcesByLowerName: Map<string, IncomeSourceEntity> | null = null;

          const transactionIds: string[] = [];

          for (let i = 0; i < dto.rows.length; i += 1) {
            const row = dto.rows[i];
            if (!row || typeof row !== 'object') {
              throw new ValidationDomainException(
                `Row ${i + 1} must be an object.`,
                'INVALID_IMPORT_ROW',
              );
            }

            if (row.entryType !== 'INCOME' && row.entryType !== 'EXPENSE') {
              throw new ValidationDomainException(
                `Row ${i + 1}: entryType must be 'INCOME' or 'EXPENSE'.`,
                'INVALID_ENTRY_TYPE',
              );
            }

            const txDate = assertValidLocalDate(row.transactionDate);
            const money = Money.positiveFromMinor(row.amountMinor, account.currencyCode);

            if (typeof row.categoryId !== 'string' || !UUID_V4_OR_ANY_REGEX.test(row.categoryId)) {
              throw new ValidationDomainException(
                `Row ${i + 1}: categoryId must be a valid UUID.`,
                'INVALID_CATEGORY_ID',
              );
            }

            const expectedKind =
              row.entryType === 'INCOME' ? CategoryKind.INCOME : CategoryKind.EXPENSE;
            const categoryCacheKey = `${row.categoryId}:${expectedKind}`;
            if (!validatedCategories.has(categoryCacheKey)) {
              const cat = await this.categoriesService.assertActiveCategoryForKind(
                userId,
                row.categoryId,
                expectedKind,
                tx,
              );
              validatedCategories.set(categoryCacheKey, cat);
            }

            const rawDesc =
              row.description === undefined || row.description === null
                ? null
                : row.description.trim();
            const description = rawDesc && rawDesc.length > 0 ? rawDesc : null;
            if (description !== null && description.length > MAX_DESCRIPTION_LENGTH) {
              throw new ValidationDomainException(
                `Row ${i + 1}: description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters.`,
                'DESCRIPTION_TOO_LONG',
              );
            }

            const rawCounterparty =
              row.counterparty === undefined || row.counterparty === null
                ? null
                : row.counterparty.trim();
            const counterparty =
              rawCounterparty && rawCounterparty.length > 0 ? rawCounterparty : null;
            if (counterparty !== null && counterparty.length > MAX_COUNTERPARTY_LENGTH) {
              throw new ValidationDomainException(
                `Row ${i + 1}: counterparty cannot exceed ${MAX_COUNTERPARTY_LENGTH} characters.`,
                'COUNTERPARTY_TOO_LONG',
              );
            }

            let incomeSourceId: string | null = null;
            let merchantId: string | null = null;

            if (counterparty !== null) {
              const lowerKey = counterparty.toLowerCase();
              if (row.entryType === 'INCOME') {
                if (!incomeSourcesByLowerName) {
                  const existingSources = await this.incomeSourcesRepo.list(tx, userId, false);
                  incomeSourcesByLowerName = new Map(
                    existingSources.map((s) => [s.name.trim().toLowerCase(), s]),
                  );
                }
                let source = incomeSourcesByLowerName.get(lowerKey);
                if (!source) {
                  source = await this.incomeSourcesRepo.create(tx, userId, counterparty);
                  incomeSourcesByLowerName.set(lowerKey, source);
                }
                incomeSourceId = source.id;
              } else {
                if (!merchantsByLowerName) {
                  const existingMerchants = await this.merchantsRepo.list(tx, userId, false);
                  merchantsByLowerName = new Map(
                    existingMerchants.map((m) => [m.name.trim().toLowerCase(), m]),
                  );
                }
                let merchant = merchantsByLowerName.get(lowerKey);
                if (!merchant) {
                  merchant = await this.merchantsRepo.create(tx, userId, counterparty);
                  merchantsByLowerName.set(lowerKey, merchant);
                }
                merchantId = merchant.id;
              }
            }

            const created = await this.ledgerRepo.insert(tx, {
              userId,
              accountId: account.id,
              entryType:
                row.entryType === 'INCOME' ? EntryType.INCOME : EntryType.EXPENSE,
              status: TransactionStatus.POSTED,
              amountMinor: money.amountMinor,
              currencyCode: account.currencyCode,
              transactionDate: txDate,
              description,
              note: null,
              categoryId: row.categoryId,
              incomeSourceId,
              merchantId,
            });

            transactionIds.push(created.id);
          }

          await this.auditRepo.record(tx, {
            userId,
            entityType: 'bulk_import',
            entityId: account.id,
            action: 'BULK_IMPORT_COMMITTED',
            metadata: {
              importedCount: transactionIds.length,
            },
          });

          return {
            status: 201,
            body: {
              accountId: account.id,
              importedCount: transactionIds.length,
              skippedCount: 0,
              transactionIds,
            },
          };
        },
      );

      return { status: exec.status, body: exec.body };
    });
  }
}

import { Inject, Injectable } from '@nestjs/common';
import {
  AccountWithBalanceDto,
  CursorPaginatedResponse,
  EntryType,
  TransactionRecordDto,
  TransactionStatus,
} from '@pfm/shared-types';
import { DATABASE_EXECUTOR, DatabaseExecutor } from '../../database/database.types';
import {
  assertValidLocalDate,
  getLocalDateInTimezone,
} from '../../shared-kernel/domain/date-time';
import {
  InvalidStateTransitionException,
  LastActiveAccountException,
  ResourceNotFoundException,
  ValidationDomainException,
} from '../../shared-kernel/domain/domain-exceptions';
import { Money } from '../../shared-kernel/domain/money';
import { summarizeAccountBalances } from '../../shared-kernel/domain/posted-balance';
import { IdempotencyService } from '../../shared-kernel/idempotency/idempotency.service';
import { AUDIT_REPOSITORY, AuditRepository } from '../audit/audit.repository';
import { LEDGER_REPOSITORY, LedgerRepository } from '../ledger/ledger.repository';
import {
  decodeLedgerCursor,
  encodeLedgerCursor,
  toTransactionRecordDto,
} from '../ledger/ledger.types';
import {
  ArchiveAccountDto,
  CreateAccountDto,
  CreateBalanceAdjustmentDto,
  UpdateAccountDto,
} from './accounts.dto';
import { ACCOUNTS_REPOSITORY, AccountsRepository } from './accounts.repository';
import { AccountEntity, toAccountWithBalanceDto } from './accounts.types';

@Injectable()
export class AccountsService {
  constructor(
    @Inject(DATABASE_EXECUTOR) private readonly db: DatabaseExecutor,
    @Inject(ACCOUNTS_REPOSITORY) private readonly accountsRepo: AccountsRepository,
    @Inject(LEDGER_REPOSITORY) private readonly ledgerRepo: LedgerRepository,
    @Inject(AUDIT_REPOSITORY) private readonly auditRepo: AuditRepository,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  public async listAccounts(
    userId: string,
    includeArchived = false,
  ): Promise<AccountWithBalanceDto[]> {
    const accounts = await this.accountsRepo.findAllByUser(this.db, userId, includeArchived);
    const entriesByAccount = await this.ledgerRepo.getBalanceEntriesForAccounts(
      this.db,
      userId,
      accounts.map((a) => a.id),
    );

    return accounts.map((account) => {
      const entries = entriesByAccount.get(account.id) ?? [];
      const summary = summarizeAccountBalances(
        account.openingBalanceMinor,
        entries,
        account.currencyCode,
      );
      return toAccountWithBalanceDto(account, summary);
    });
  }

  public async getAccount(userId: string, accountId: string): Promise<AccountWithBalanceDto> {
    const account = await this.accountsRepo.findById(this.db, userId, accountId);
    if (!account) {
      throw new ResourceNotFoundException('Account');
    }

    const entriesMap = await this.ledgerRepo.getBalanceEntriesForAccounts(this.db, userId, [account.id]);
    const summary = summarizeAccountBalances(
      account.openingBalanceMinor,
      entriesMap.get(account.id) ?? [],
      account.currencyCode,
    );
    return toAccountWithBalanceDto(account, summary);
  }

  public async createAccount(
    userId: string,
    userTimezone: string,
    dto: CreateAccountDto,
  ): Promise<AccountWithBalanceDto> {
    const trimmedName = dto.name.trim();
    if (trimmedName.length === 0) {
      throw new ValidationDomainException('Account name cannot be empty.');
    }

    const openingMoney =
      dto.openingBalanceMinor !== undefined || dto.openingBalance !== undefined
        ? Money.fromApiInput({
            amountMinor: dto.openingBalanceMinor,
            amount: dto.openingBalance,
            currencyCode: dto.currencyCode,
            allowZero: true,
            allowNegative: true,
          })
        : Money.zero(dto.currencyCode);

    const openingDate = dto.openingBalanceDate
      ? assertValidLocalDate(dto.openingBalanceDate)
      : getLocalDateInTimezone(new Date(), userTimezone);

    const created = await this.db.withTransaction(async (tx) => {
      const activeCount = await this.accountsRepo.countActiveByUser(tx, userId);
      const shouldBeDefault = dto.isDefault === true || activeCount === 0;

      if (shouldBeDefault) {
        await this.accountsRepo.clearDefaultForUser(tx, userId);
      }

      const account = await this.accountsRepo.create(tx, {
        userId,
        name: trimmedName,
        accountType: dto.accountType,
        currencyCode: openingMoney.currencyCode,
        openingBalanceMinor: openingMoney.amountMinor,
        openingBalanceDate: openingDate,
        isDefault: shouldBeDefault,
      });

      await this.auditRepo.record(tx, {
        userId,
        entityType: 'account',
        entityId: account.id,
        action: 'ACCOUNT_CREATED',
        metadata: {
          accountType: account.accountType,
          currencyCode: account.currencyCode,
          isDefault: account.isDefault,
        },
      });

      return account;
    });

    const summary = summarizeAccountBalances(created.openingBalanceMinor, [], created.currencyCode);
    return toAccountWithBalanceDto(created, summary);
  }

  public async updateAccount(
    userId: string,
    accountId: string,
    dto: UpdateAccountDto,
  ): Promise<AccountWithBalanceDto> {
    if (dto.name !== undefined && dto.name.trim().length === 0) {
      throw new ValidationDomainException('Account name cannot be empty.');
    }

    const updated = await this.db.withTransaction(async (tx) => {
      const existing = await this.accountsRepo.findById(tx, userId, accountId, true);
      if (!existing) {
        throw new ResourceNotFoundException('Account');
      }
      if (existing.archivedAt !== null) {
        throw new InvalidStateTransitionException('Cannot update an archived account.');
      }

      let normalizedCurrency: AccountEntity['currencyCode'] | undefined;
      if (dto.currencyCode !== undefined) {
        const validated = Money.zero(dto.currencyCode);
        if (validated.currencyCode !== existing.currencyCode) {
          // BR-ACC-04: Account currency is immutable once transactions exist
          const txCount = await this.ledgerRepo.countTransactionsForAccount(tx, userId, accountId);
          if (txCount > 0) {
            throw new InvalidStateTransitionException(
              'Cannot change account currency after transactions have been recorded.',
              'ACCOUNT_CURRENCY_IMMUTABLE',
            );
          }
          normalizedCurrency = validated.currencyCode;
        }
      }

      if (dto.isDefault === false && existing.isDefault) {
        throw new InvalidStateTransitionException(
          'Cannot unset the default account directly; promote another active account to default instead.',
          'DEFAULT_ACCOUNT_REQUIRED',
        );
      }

      if (dto.isDefault === true && !existing.isDefault) {
        await this.accountsRepo.clearDefaultForUser(tx, userId);
      }

      return this.accountsRepo.update(tx, userId, accountId, {
        name: dto.name !== undefined ? dto.name.trim() : undefined,
        accountType: dto.accountType,
        currencyCode: normalizedCurrency,
        isDefault: dto.isDefault,
      });
    });

    const entriesMap = await this.ledgerRepo.getBalanceEntriesForAccounts(this.db, userId, [updated.id]);
    const summary = summarizeAccountBalances(
      updated.openingBalanceMinor,
      entriesMap.get(updated.id) ?? [],
      updated.currencyCode,
    );
    return toAccountWithBalanceDto(updated, summary);
  }

  public async archiveAccount(
    userId: string,
    accountId: string,
    dto?: ArchiveAccountDto,
  ): Promise<AccountWithBalanceDto> {
    const archived = await this.db.withTransaction(async (tx) => {
      const activeAccounts = await this.accountsRepo.findActiveByUserForUpdate(tx, userId);
      const target = activeAccounts.find((a) => a.id === accountId);

      if (!target) {
        const existingAny = await this.accountsRepo.findById(tx, userId, accountId);
        if (!existingAny) {
          throw new ResourceNotFoundException('Account');
        }
        throw new InvalidStateTransitionException(
          'Account is already archived.',
          'ACCOUNT_ALREADY_ARCHIVED',
        );
      }

      // BR-ACC-05: Never archive the last remaining active account
      if (activeAccounts.length <= 1) {
        throw new LastActiveAccountException(
          'Cannot archive the last active account. At least one active account is required.',
        );
      }

      // BR-ACC-05: Cannot archive active default account without reassigning default first
      if (target.isDefault) {
        const replacementId = dto?.replacementDefaultAccountId;
        if (!replacementId || replacementId === accountId) {
          throw new LastActiveAccountException(
            'Cannot archive the default account without reassigning default to another active account.',
          );
        }
        const replacement = activeAccounts.find((a) => a.id === replacementId);
        if (!replacement) {
          throw new ResourceNotFoundException('Replacement default account');
        }
        await this.accountsRepo.clearDefaultForUser(tx, userId);
        await this.accountsRepo.update(tx, userId, replacement.id, { isDefault: true });
      }

      const archivedEntity = await this.accountsRepo.archive(tx, userId, accountId);

      await this.auditRepo.record(tx, {
        userId,
        entityType: 'account',
        entityId: accountId,
        action: 'ACCOUNT_ARCHIVED',
      });

      return archivedEntity;
    });

    const entriesMap = await this.ledgerRepo.getBalanceEntriesForAccounts(this.db, userId, [archived.id]);
    const summary = summarizeAccountBalances(
      archived.openingBalanceMinor,
      entriesMap.get(archived.id) ?? [],
      archived.currencyCode,
    );
    return toAccountWithBalanceDto(archived, summary);
  }

  public async getAccountLedger(
    userId: string,
    accountId: string,
    params: { limit?: number; cursor?: string },
  ): Promise<CursorPaginatedResponse<TransactionRecordDto>> {
    const account = await this.accountsRepo.findById(this.db, userId, accountId);
    if (!account) {
      throw new ResourceNotFoundException('Account');
    }

    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    const decodedCursor = params.cursor ? decodeLedgerCursor(params.cursor) : undefined;

    const { items, hasMore } = await this.ledgerRepo.list(this.db, {
      userId,
      accountId,
      limit,
      cursor: decodedCursor,
    });

    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeLedgerCursor({
            transactionDate: last.transactionDate,
            createdAt: last.createdAt.toISOString(),
            id: last.id,
          })
        : null;

    return {
      items: items.map(toTransactionRecordDto),
      nextCursor,
      hasMore,
    };
  }

  public async createBalanceAdjustment(
    userId: string,
    userTimezone: string,
    accountId: string,
    idempotencyKey: string | undefined,
    requestPath: string,
    dto: CreateBalanceAdjustmentDto,
  ): Promise<{ status: number; body: { transaction: TransactionRecordDto; postedBalanceMinor: string } }> {
    const txDate = dto.transactionDate
      ? assertValidLocalDate(dto.transactionDate)
      : getLocalDateInTimezone(new Date(), userTimezone);

    return this.db.withTransaction(async (tx) => {
      const exec = await this.idempotencyService.execute(
        tx,
        {
          userId,
          idempotencyKey,
          method: 'POST',
          path: requestPath,
          payload: dto,
        },
        async () => {
          const account = await this.accountsRepo.findById(tx, userId, accountId, true);
          if (!account) {
            throw new ResourceNotFoundException('Account');
          }
          if (account.archivedAt !== null) {
            throw new InvalidStateTransitionException(
              'Cannot adjust balance of an archived account.',
              'ACCOUNT_ARCHIVED',
            );
          }

          const entriesMap = await this.ledgerRepo.getBalanceEntriesForAccounts(tx, userId, [account.id]);
          const currentSummary = summarizeAccountBalances(
            account.openingBalanceMinor,
            entriesMap.get(account.id) ?? [],
            account.currencyCode,
          );

          let entryType: EntryType;
          let adjustmentMinor: bigint;

          if (dto.actualBalanceMinor !== undefined || dto.actualBalance !== undefined) {
            const targetMoney = Money.fromApiInput({
              amountMinor: dto.actualBalanceMinor,
              amount: dto.actualBalance,
              currencyCode: account.currencyCode,
              allowZero: true,
              allowNegative: true,
            });
            const delta = targetMoney.amountMinor - currentSummary.postedBalanceMinor;
            if (delta === 0n) {
              throw new ValidationDomainException(
                'Actual balance matches current posted balance; no adjustment needed.',
                'NO_ADJUSTMENT_DIFFERENCE',
              );
            }
            entryType = delta > 0n ? EntryType.ADJUSTMENT_CREDIT : EntryType.ADJUSTMENT_DEBIT;
            adjustmentMinor = delta > 0n ? delta : -delta;
          } else if (dto.direction && (dto.amountMinor !== undefined || dto.amount !== undefined)) {
            const money = Money.fromApiInput({
              amountMinor: dto.amountMinor,
              amount: dto.amount,
              currencyCode: account.currencyCode,
            });
            entryType =
              dto.direction === 'CREDIT' ? EntryType.ADJUSTMENT_CREDIT : EntryType.ADJUSTMENT_DEBIT;
            adjustmentMinor = money.amountMinor;
          } else {
            throw new ValidationDomainException(
              'Provide either actualBalance/actualBalanceMinor or direction with amount/amountMinor.',
              'INVALID_ADJUSTMENT_PAYLOAD',
            );
          }

          const inserted = await this.ledgerRepo.insert(tx, {
            userId,
            accountId: account.id,
            entryType,
            status: TransactionStatus.POSTED,
            amountMinor: adjustmentMinor,
            currencyCode: account.currencyCode,
            transactionDate: txDate,
            description: dto.description ?? 'Balance reconciliation adjustment',
            note: dto.note ?? null,
          });

          await this.auditRepo.record(tx, {
            userId,
            entityType: 'transaction',
            entityId: inserted.id,
            action: 'BALANCE_ADJUSTMENT_POSTED',
            metadata: { accountId: account.id, entryType },
          });

          const newBalance =
            entryType === EntryType.ADJUSTMENT_CREDIT
              ? currentSummary.postedBalanceMinor + adjustmentMinor
              : currentSummary.postedBalanceMinor - adjustmentMinor;

          return {
            status: 201,
            body: {
              transaction: toTransactionRecordDto(inserted),
              postedBalanceMinor: newBalance.toString(),
            },
          };
        },
      );

      return { status: exec.status, body: exec.body };
    });
  }
}

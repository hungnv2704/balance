import { Inject, Injectable } from '@nestjs/common';
import { DbQueryClient } from '../../database/database.types';
import {
  DefaultAccountNotFoundException,
  InvalidStateTransitionException,
  ResourceNotFoundException,
} from '../../shared-kernel/domain/domain-exceptions';
import { ACCOUNTS_REPOSITORY, AccountsRepository } from './accounts.repository';
import { AccountEntity } from './accounts.types';

@Injectable()
export class DefaultAccountResolver {
  constructor(
    @Inject(ACCOUNTS_REPOSITORY) private readonly accountsRepo: AccountsRepository,
  ) {}

  /**
   * Resolves either an explicitly provided account_id (verifying user ownership and active state)
   * or automatically resolves to the user's active Default Account ("Sổ chung") when omitted (BR-ACC-06).
   */
  public async resolveForTransaction(
    db: DbQueryClient,
    userId: string,
    requestedAccountId?: string | null,
  ): Promise<AccountEntity> {
    if (requestedAccountId !== undefined && requestedAccountId !== null && requestedAccountId.trim().length > 0) {
      const account = await this.accountsRepo.findById(db, userId, requestedAccountId.trim());
      if (!account) {
        throw new ResourceNotFoundException('Account');
      }
      if (account.archivedAt !== null) {
        throw new InvalidStateTransitionException(
          'Cannot create or update transactions on an archived account.',
          'ACCOUNT_ARCHIVED',
        );
      }
      return account;
    }

    const defaultAccount = await this.accountsRepo.findDefaultActiveByUser(db, userId);
    if (defaultAccount) {
      return defaultAccount;
    }

    // Defensive fallback if user has exactly 1 active account without is_default flag
    const activeAccounts = await this.accountsRepo.findAllByUser(db, userId, false);
    if (activeAccounts.length === 1) {
      return activeAccounts[0];
    }

    throw new DefaultAccountNotFoundException();
  }

  public async getActiveAccountCount(db: DbQueryClient, userId: string): Promise<number> {
    return this.accountsRepo.countActiveByUser(db, userId);
  }
}

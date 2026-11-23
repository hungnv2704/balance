import { Injectable } from '@nestjs/common';
import { CategoryKind, EntryType, SupportedCurrencyCode } from '@pfm/shared-types';
import { DbQueryClient } from '../../database/database.types';
import {
  CashFlowAggregateRow,
  CashFlowQueryParams,
  ReportingRepository,
} from './reporting.repository';

interface AggregateRowRaw {
  currency_code: SupportedCurrencyCode;
  entry_type: EntryType.INCOME | EntryType.EXPENSE | EntryType.EXPENSE_REFUND;
  category_id: string;
  category_name: string;
  category_kind: CategoryKind;
  total_minor: string;
  tx_count: number;
}

@Injectable()
export class PgReportingRepository implements ReportingRepository {
  public async aggregatePostedCashFlow(
    db: DbQueryClient,
    params: CashFlowQueryParams,
  ): Promise<CashFlowAggregateRow[]> {
    const sqlParams: unknown[] = [params.userId, params.fromDate, params.toDate];
    const extraClauses: string[] = [];

    if (params.currencyCode) {
      sqlParams.push(params.currencyCode);
      extraClauses.push(`AND t.currency_code = $${sqlParams.length}`);
    }
    if (params.accountId) {
      sqlParams.push(params.accountId);
      extraClauses.push(`AND t.account_id = $${sqlParams.length}`);
    }

    const result = await db.query<AggregateRowRaw>(
      `SELECT
         t.currency_code,
         t.entry_type,
         t.category_id,
         c.name AS category_name,
         c.kind AS category_kind,
         SUM(t.amount_minor)::text AS total_minor,
         COUNT(*)::int AS tx_count
       FROM transactions t
       INNER JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
       WHERE t.user_id = $1
         AND t.status = 'POSTED'
         AND t.entry_type IN ('INCOME', 'EXPENSE', 'EXPENSE_REFUND')
         AND t.transaction_date >= $2::date
         AND t.transaction_date <= $3::date
         ${extraClauses.join('\n         ')}
       GROUP BY t.currency_code, t.entry_type, t.category_id, c.name, c.kind`,
      sqlParams,
    );

    return result.rows.map((row) => ({
      currencyCode: row.currency_code.trim() as SupportedCurrencyCode,
      entryType: row.entry_type,
      categoryId: row.category_id,
      categoryName: row.category_name,
      categoryKind: row.category_kind,
      totalMinor: BigInt(row.total_minor),
      transactionCount: Number(row.tx_count),
    }));
  }
}

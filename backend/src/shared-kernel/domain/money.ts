import {
  CurrencyMetadata,
  SupportedCurrencyCode,
  getCurrencyMetadata,
} from '@pfm/shared-types';
import {
  CurrencyMismatchException,
  InvalidCurrencyException,
  ValidationDomainException,
} from './domain-exceptions';

export const PG_BIGINT_MIN = -(2n ** 63n);
export const PG_BIGINT_MAX = 2n ** 63n - 1n;

const INTEGER_STRING_REGEX = /^\s*(-?\d+)\s*$/;
const DECIMAL_STRING_REGEX = /^\s*(-)?(\d+)(?:\.(\d+))?\s*$/;
const POSITIVE_RATE_REGEX = /^\s*(\d+)(?:\.(\d+))?\s*$/;

function assertPgBigintBounds(value: bigint): void {
  if (value < PG_BIGINT_MIN || value > PG_BIGINT_MAX) {
    throw new ValidationDomainException(
      'Monetary amount exceeds signed 64-bit BIGINT storage bounds.',
      'AMOUNT_OUT_OF_RANGE',
    );
  }
}

/**
 * Exact division with Banker's Rounding (Round Half to Even).
 * Never uses IEEE-754 floating-point arithmetic.
 */
export function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new ValidationDomainException('Rounding denominator must be strictly positive.');
  }
  if (numerator === 0n) {
    return 0n;
  }

  const sign = numerator < 0n ? -1n : 1n;
  const absNum = numerator < 0n ? -numerator : numerator;

  const quotient = absNum / denominator;
  const remainder = absNum % denominator;
  const twiceRemainder = remainder * 2n;

  let roundedAbs = quotient;
  if (twiceRemainder > denominator) {
    roundedAbs = quotient + 1n;
  } else if (twiceRemainder === denominator) {
    // Exact .5 tie: round toward even integer
    if (quotient % 2n !== 0n) {
      roundedAbs = quotient + 1n;
    }
  }

  const result = roundedAbs * sign;
  assertPgBigintBounds(result);
  return result;
}

export class Money {
  public readonly amountMinor: bigint;
  public readonly currencyCode: SupportedCurrencyCode;
  public readonly metadata: CurrencyMetadata;

  private constructor(amountMinor: bigint, metadata: CurrencyMetadata) {
    assertPgBigintBounds(amountMinor);
    this.amountMinor = amountMinor;
    this.currencyCode = metadata.code;
    this.metadata = metadata;
  }

  private static resolveCurrency(currencyCode: string): CurrencyMetadata {
    if (typeof currencyCode !== 'string' || currencyCode.trim().length === 0) {
      throw new InvalidCurrencyException(String(currencyCode ?? ''));
    }
    const meta = getCurrencyMetadata(currencyCode);
    if (!meta) {
      throw new InvalidCurrencyException(currencyCode);
    }
    return meta;
  }

  public static zero(currencyCode: string): Money {
    const meta = Money.resolveCurrency(currencyCode);
    return new Money(0n, meta);
  }

  public static fromMinor(amountMinor: bigint | number | string, currencyCode: string): Money {
    const meta = Money.resolveCurrency(currencyCode);

    let parsed: bigint;
    if (typeof amountMinor === 'bigint') {
      parsed = amountMinor;
    } else if (typeof amountMinor === 'number') {
      if (!Number.isFinite(amountMinor) || !Number.isInteger(amountMinor) || !Number.isSafeInteger(amountMinor)) {
        throw new ValidationDomainException(
          'Monetary minor unit number must be a safe integer.',
          'INVALID_MINOR_UNIT',
        );
      }
      parsed = BigInt(amountMinor);
    } else if (typeof amountMinor === 'string') {
      const match = INTEGER_STRING_REGEX.exec(amountMinor);
      if (!match) {
        throw new ValidationDomainException(
          `Invalid integer minor unit string for currency ${meta.code}.`,
          'INVALID_MINOR_UNIT',
        );
      }
      parsed = BigInt(match[1]);
    } else {
      throw new ValidationDomainException('Monetary minor unit must be bigint, safe integer, or integer string.');
    }

    return new Money(parsed, meta);
  }

  public static positiveFromMinor(amountMinor: bigint | number | string, currencyCode: string): Money {
    const money = Money.fromMinor(amountMinor, currencyCode);
    if (money.amountMinor <= 0n) {
      throw new ValidationDomainException(
        'Transaction amount must be strictly greater than zero.',
        'NON_POSITIVE_AMOUNT',
      );
    }
    return money;
  }

  public static fromDecimalString(
    decimalValue: string,
    currencyCode: string,
    options?: { allowZero?: boolean; allowNegative?: boolean },
  ): Money {
    const meta = Money.resolveCurrency(currencyCode);
    if (typeof decimalValue !== 'string') {
      throw new ValidationDomainException('Monetary decimal input must be a string.');
    }

    const match = DECIMAL_STRING_REGEX.exec(decimalValue);
    if (!match) {
      throw new ValidationDomainException(
        `Invalid decimal monetary format for ${meta.code}.`,
        'INVALID_MONETARY_FORMAT',
      );
    }

    const [, signStr, integerPart, fractionalPart] = match;
    const isNegative = signStr === '-';

    if (fractionalPart !== undefined) {
      if (meta.minorUnit === 0) {
        throw new ValidationDomainException(
          `Currency ${meta.code} has 0 decimal places and does not allow fractional digits.`,
          'INVALID_CURRENCY_PRECISION',
        );
      }
      if (fractionalPart.length > meta.minorUnit) {
        throw new ValidationDomainException(
          `Currency ${meta.code} allows at most ${meta.minorUnit} decimal place(s).`,
          'INVALID_CURRENCY_PRECISION',
        );
      }
    }

    const paddedFraction = (fractionalPart ?? '').padEnd(meta.minorUnit, '0');
    const combinedDigits = `${integerPart}${paddedFraction}`;
    let minor = BigInt(combinedDigits);
    if (isNegative && minor !== 0n) {
      minor = -minor;
    }

    const allowNegative = options?.allowNegative ?? false;
    const allowZero = options?.allowZero ?? false;

    if (!allowNegative && minor < 0n) {
      throw new ValidationDomainException(
        'Monetary amount cannot be negative.',
        'NEGATIVE_AMOUNT_NOT_ALLOWED',
      );
    }
    if (!allowZero && minor === 0n) {
      throw new ValidationDomainException(
        'Monetary amount must be greater than zero.',
        'ZERO_AMOUNT_NOT_ALLOWED',
      );
    }

    return new Money(minor, meta);
  }

  public static parseDecimal(
    decimalValue: string,
    currencyCode: string,
    options?: { allowZero?: boolean; allowNegative?: boolean },
  ): Money {
    return Money.fromDecimalString(decimalValue, currencyCode, options);
  }

  /**
   * Parses flexible API input accepting either canonical `amountMinor` (integer)
   * or `amount` (decimal string matching currency minorUnit), enforcing zero ambiguity.
   */
  public static fromApiInput(params: {
    amountMinor?: bigint | number | string;
    amount?: string;
    currencyCode: string;
    allowZero?: boolean;
    allowNegative?: boolean;
  }): Money {
    const { amountMinor, amount, currencyCode, allowZero = false, allowNegative = false } = params;

    if (amountMinor !== undefined && amount !== undefined) {
      const fromMinor = Money.fromMinor(amountMinor, currencyCode);
      const fromDecimal = Money.fromDecimalString(amount, currencyCode, { allowZero, allowNegative });
      if (!fromMinor.equals(fromDecimal)) {
        throw new ValidationDomainException(
          'Conflicting amountMinor and amount values provided.',
          'AMBIGUOUS_AMOUNT_INPUT',
        );
      }
      return fromDecimal;
    }

    if (amount !== undefined) {
      return Money.fromDecimalString(amount, currencyCode, { allowZero, allowNegative });
    }

    if (amountMinor !== undefined) {
      const money = Money.fromMinor(amountMinor, currencyCode);
      if (!allowNegative && money.amountMinor < 0n) {
        throw new ValidationDomainException('Monetary amount cannot be negative.', 'NEGATIVE_AMOUNT_NOT_ALLOWED');
      }
      if (!allowZero && money.amountMinor === 0n) {
        throw new ValidationDomainException('Monetary amount must be greater than zero.', 'ZERO_AMOUNT_NOT_ALLOWED');
      }
      return money;
    }

    throw new ValidationDomainException('Either amountMinor or amount is required.', 'MISSING_AMOUNT');
  }

  public assertSameCurrency(other: Money): void {
    if (this.currencyCode !== other.currencyCode) {
      throw new CurrencyMismatchException(this.currencyCode, other.currencyCode);
    }
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor + other.amountMinor, this.metadata);
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor - other.amountMinor, this.metadata);
  }

  public negate(): Money {
    return new Money(-this.amountMinor, this.metadata);
  }

  public abs(): Money {
    return new Money(this.amountMinor < 0n ? -this.amountMinor : this.amountMinor, this.metadata);
  }

  public isZero(): boolean {
    return this.amountMinor === 0n;
  }

  public isPositive(): boolean {
    return this.amountMinor > 0n;
  }

  public isNegative(): boolean {
    return this.amountMinor < 0n;
  }

  public equals(other: Money): boolean {
    return this.currencyCode === other.currencyCode && this.amountMinor === other.amountMinor;
  }

  public compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.amountMinor < other.amountMinor) return -1;
    if (this.amountMinor > other.amountMinor) return 1;
    return 0;
  }

  /**
   * Converts this monetary amount into `targetCurrencyCode` using an exact decimal
   * exchange rate (where 1 major unit of source = `exchangeRate` major units of target),
   * applying Banker's Rounding (Half-Even) at the target currency minor unit boundary.
   */
  public convertWithRate(targetCurrencyCode: string, exchangeRate: string): Money {
    const targetMeta = Money.resolveCurrency(targetCurrencyCode);
    if (typeof exchangeRate !== 'string') {
      throw new ValidationDomainException('Exchange rate must be a decimal string.');
    }

    const match = POSITIVE_RATE_REGEX.exec(exchangeRate);
    if (!match) {
      throw new ValidationDomainException(
        'Exchange rate must be a valid positive decimal string.',
        'INVALID_EXCHANGE_RATE',
      );
    }

    const [, intPart, fracPart = ''] = match;
    const rateNumerator = BigInt(`${intPart}${fracPart}`);
    if (rateNumerator <= 0n) {
      throw new ValidationDomainException(
        'Exchange rate must be strictly positive (> 0).',
        'INVALID_EXCHANGE_RATE',
      );
    }

    const rateScale = fracPart.length;
    const exponentDiff = targetMeta.minorUnit - this.metadata.minorUnit - rateScale;

    let numerator = this.amountMinor * rateNumerator;
    let denominator = 1n;

    if (exponentDiff > 0) {
      numerator *= 10n ** BigInt(exponentDiff);
    } else if (exponentDiff < 0) {
      denominator = 10n ** BigInt(-exponentDiff);
    }

    const roundedTargetMinor = roundHalfEven(numerator, denominator);
    return new Money(roundedTargetMinor, targetMeta);
  }

  public toMinorString(): string {
    return this.amountMinor.toString();
  }

  public toDecimalString(): string {
    const sign = this.amountMinor < 0n ? '-' : '';
    const absStr = (this.amountMinor < 0n ? -this.amountMinor : this.amountMinor).toString();
    const scale = this.metadata.minorUnit;

    if (scale === 0) {
      return `${sign}${absStr}`;
    }

    const padded = absStr.padStart(scale + 1, '0');
    const splitAt = padded.length - scale;
    const intPart = padded.slice(0, splitAt);
    const fracPart = padded.slice(splitAt);
    return `${sign}${intPart}.${fracPart}`;
  }
}

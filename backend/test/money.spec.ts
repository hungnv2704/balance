import {
  CurrencyMismatchException,
  InvalidCurrencyException,
  ValidationDomainException,
} from '../src/shared-kernel/domain/domain-exceptions';
import { Money, PG_BIGINT_MAX, roundHalfEven } from '../src/shared-kernel/domain/money';

describe('Money Value Object & Banker Rounding', () => {
  describe('ISO 4217 precision & decimal parsing', () => {
    it('parses VND (minorUnit = 0) exact integers and rejects decimals', () => {
      const m = Money.fromDecimalString('150000', 'VND');
      expect(m.amountMinor).toBe(150000n);
      expect(m.currencyCode).toBe('VND');
      expect(m.toDecimalString()).toBe('150000');

      expect(() => Money.fromDecimalString('100.50', 'VND')).toThrow(ValidationDomainException);
      expect(() => Money.fromDecimalString('100.0', 'VND')).toThrow(ValidationDomainException);
      expect(() => Money.fromDecimalString('100.50', 'JPY')).toThrow(ValidationDomainException);
    });

    it('parses USD/EUR (minorUnit = 2) cleanly without floating-point errors', () => {
      const a = Money.fromDecimalString('0.10', 'USD');
      const b = Money.fromDecimalString('0.20', 'USD');
      const sum = a.add(b);

      expect(a.amountMinor).toBe(10n);
      expect(b.amountMinor).toBe(20n);
      expect(sum.amountMinor).toBe(30n);
      expect(sum.toDecimalString()).toBe('0.30');

      expect(Money.fromDecimalString('10.5', 'USD').amountMinor).toBe(1050n);
      expect(Money.fromDecimalString('10', 'EUR').amountMinor).toBe(1000n);
      expect(() => Money.fromDecimalString('10.555', 'USD')).toThrow(ValidationDomainException);
    });

    it('parses KWD (minorUnit = 3) cleanly and rejects 4 decimal places', () => {
      const kwd = Money.fromDecimalString('12.345', 'KWD');
      expect(kwd.amountMinor).toBe(12345n);
      expect(kwd.toDecimalString()).toBe('12.345');

      const tiny = Money.fromMinor(5n, 'KWD');
      expect(tiny.toDecimalString()).toBe('0.005');

      expect(() => Money.fromDecimalString('12.3456', 'KWD')).toThrow(ValidationDomainException);
    });

    it('rejects unsupported currency codes and float inputs in fromMinor', () => {
      expect(() => Money.fromMinor(100n, 'XYZ')).toThrow(InvalidCurrencyException);
      expect(() => Money.fromMinor(100.5, 'USD')).toThrow(ValidationDomainException);
      expect(() => Money.fromMinor('100.50', 'VND')).toThrow(ValidationDomainException);
      expect(() => Money.fromMinor(Number.MAX_SAFE_INTEGER + 1, 'VND')).toThrow(
        ValidationDomainException,
      );
    });

    it('preserves exact bigint arithmetic above Number.MAX_SAFE_INTEGER within 64-bit BIGINT bounds', () => {
      const a = Money.fromMinor('9007199254740993', 'VND');
      const b = Money.fromMinor('2', 'VND');
      expect(a.add(b).amountMinor).toBe(9007199254740995n);
      expect(a.subtract(b).amountMinor).toBe(9007199254740991n);

      expect(() => Money.fromMinor(PG_BIGINT_MAX + 1n, 'VND')).toThrow(ValidationDomainException);
    });

    it('forbids mixing different currencies in add, subtract, and compare', () => {
      const vnd = Money.fromMinor(100000n, 'VND');
      const usd = Money.fromMinor(1000n, 'USD');

      expect(() => vnd.add(usd)).toThrow(CurrencyMismatchException);
      expect(() => vnd.subtract(usd)).toThrow(CurrencyMismatchException);
      expect(() => vnd.compare(usd)).toThrow(CurrencyMismatchException);
    });

    it('validates API dual input consistency', () => {
      expect(
        Money.fromApiInput({ amountMinor: '1050', amount: '10.50', currencyCode: 'USD' }).amountMinor,
      ).toBe(1050n);

      expect(() =>
        Money.fromApiInput({ amountMinor: '1051', amount: '10.50', currencyCode: 'USD' }),
      ).toThrow(ValidationDomainException);

      expect(() =>
        Money.fromApiInput({ amountMinor: '0', currencyCode: 'USD' }),
      ).toThrow(ValidationDomainException);

      expect(
        Money.fromApiInput({ amountMinor: '0', currencyCode: 'USD', allowZero: true }).amountMinor,
      ).toBe(0n);
    });
  });

  describe('Banker Rounding (Half-Even)', () => {
    it('rounds exact .5 ties toward nearest even integer (docs/08 worked examples)', () => {
      expect(roundHalfEven(1n, 2n)).toBe(0n); // 0.5 -> 0
      expect(roundHalfEven(3n, 2n)).toBe(2n); // 1.5 -> 2
      expect(roundHalfEven(5n, 2n)).toBe(2n); // 2.5 -> 2
      expect(roundHalfEven(7n, 2n)).toBe(4n); // 3.5 -> 4
      expect(roundHalfEven(-5n, 2n)).toBe(-2n); // -2.5 -> -2
      expect(roundHalfEven(-7n, 2n)).toBe(-4n); // -3.5 -> -4

      expect(roundHalfEven(2500001n, 1000000n)).toBe(3n); // > 2.5 -> 3
      expect(roundHalfEven(2499999n, 1000000n)).toBe(2n); // < 2.5 -> 2
    });

    it('converts USD to EUR with Half-Even rounding on 0.05 and 0.07 USD * 0.5', () => {
      const fiveCents = Money.fromDecimalString('0.05', 'USD');
      const sevenCents = Money.fromDecimalString('0.07', 'USD');

      // 5 * 0.5 = 2.5 minor -> 2 (even)
      expect(fiveCents.convertWithRate('EUR', '0.5').amountMinor).toBe(2n);
      // 7 * 0.5 = 3.5 minor -> 4 (even)
      expect(sevenCents.convertWithRate('EUR', '0.5').amountMinor).toBe(4n);
    });

    it('converts 10.01 USD at 25450 to 254,754 VND (Half-Even on .5)', () => {
      const usd = Money.fromDecimalString('10.01', 'USD');
      // 10.01 * 25450 = 254,754.5 VND -> rounds to even 254,754
      const vndEven = usd.convertWithRate('VND', '25450');
      expect(vndEven.currencyCode).toBe('VND');
      expect(vndEven.amountMinor).toBe(254754n);

      // 10.03 * 25450 = 255,263.5 VND -> rounds to even 255,264
      const usdOdd = Money.fromDecimalString('10.03', 'USD');
      const vndOdd = usdOdd.convertWithRate('VND', '25450');
      expect(vndOdd.amountMinor).toBe(255264n);
    });

    it('converts across KWD (d=3) and VND (d=0) with exact scaling', () => {
      const kwd = Money.fromDecimalString('1.235', 'KWD');
      // 1.235 * 1000 = 1235.0 VND
      expect(kwd.convertWithRate('VND', '1000').amountMinor).toBe(1235n);

      // 1 USD (100 minor, d=2) at 0.3055 -> 0.3055 KWD = 305.5 fils -> 306 fils (even)
      const oneUsd = Money.fromDecimalString('1.00', 'USD');
      expect(oneUsd.convertWithRate('KWD', '0.3055').amountMinor).toBe(306n);
    });

    it('rejects non-positive or malformed exchange rates', () => {
      const usd = Money.fromDecimalString('10.00', 'USD');
      expect(() => usd.convertWithRate('VND', '0')).toThrow(ValidationDomainException);
      expect(() => usd.convertWithRate('VND', '-25000')).toThrow(ValidationDomainException);
      expect(() => usd.convertWithRate('VND', 'abc')).toThrow(ValidationDomainException);
    });
  });
});

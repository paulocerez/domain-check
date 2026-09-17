import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALERT_LEAD_DAYS,
  resolveEffectivePrice,
  selectExpiryAlertKind,
  sumAnnualized,
  parseMoneyToCents,
  type TldPriceDTO,
} from '@domain-check/shared';

const tldPrice = (over: Partial<TldPriceDTO> = {}): TldPriceDTO => ({
  id: 'p1',
  tld: 'de',
  renewalCents: 1200,
  registrationCents: null,
  transferCents: null,
  currency: 'EUR',
  termMonths: 12,
  source: 'seed',
  notes: null,
  updatedAt: new Date().toISOString(),
  ...over,
});

const domain = (over = {}) => ({
  tld: 'de',
  priceOverrideCents: null,
  priceCurrency: null,
  termMonthsOverride: null,
  ...over,
});

describe('resolveEffectivePrice', () => {
  it('prefers a per-domain override over the TLD table', () => {
    const price = resolveEffectivePrice(
      domain({ priceOverrideCents: 2599, priceCurrency: 'EUR' }),
      tldPrice(),
      'EUR',
    );
    expect(price).toMatchObject({ source: 'override', renewalCents: 2599, annualizedCents: 2599 });
  });

  it('falls back to the TLD table', () => {
    expect(resolveEffectivePrice(domain(), tldPrice(), 'EUR')).toMatchObject({
      source: 'tld',
      renewalCents: 1200,
    });
  });

  it('reports unknown rather than zero when nothing is priced', () => {
    const price = resolveEffectivePrice(domain({ tld: 'bayern' }), null, 'EUR');
    // A missing price must never read as free — that would make a total look
    // authoritative while being silently wrong.
    expect(price).toMatchObject({ source: 'unknown', renewalCents: null, annualizedCents: null });
  });

  it('annualises a multi-year term', () => {
    const price = resolveEffectivePrice(domain(), tldPrice({ renewalCents: 3000, termMonths: 24 }), 'EUR');
    expect(price.annualizedCents).toBe(1500);
  });

  it('lets a domain override just the term length', () => {
    const price = resolveEffectivePrice(
      domain({ termMonthsOverride: 24 }),
      tldPrice({ renewalCents: 3000 }),
      'EUR',
    );
    expect(price).toMatchObject({ termMonths: 24, annualizedCents: 1500 });
  });

  it('flags a currency mismatch instead of converting', () => {
    const price = resolveEffectivePrice(domain(), tldPrice({ currency: 'USD' }), 'EUR');
    expect(price.currencyMismatch).toBe(true);
  });
});

describe('sumAnnualized', () => {
  it('excludes foreign-currency and unpriced domains from the total, and counts them', () => {
    const total = sumAnnualized(
      [
        resolveEffectivePrice(domain(), tldPrice({ renewalCents: 1200 }), 'EUR'),
        resolveEffectivePrice(domain(), tldPrice({ renewalCents: 1500 }), 'EUR'),
        resolveEffectivePrice(domain(), tldPrice({ renewalCents: 9900, currency: 'USD' }), 'EUR'),
        resolveEffectivePrice(domain({ tld: 'bayern' }), null, 'EUR'),
      ],
      'EUR',
    );
    expect(total).toEqual({
      totalCents: 2700,
      currency: 'EUR',
      countedDomains: 2,
      excludedForCurrency: 1,
      unknownPrice: 1,
    });
  });
});

describe('selectExpiryAlertKind', () => {
  const leads = [...DEFAULT_ALERT_LEAD_DAYS];

  it('picks only the tightest threshold crossed', () => {
    // 5 days left crosses 60, 30, 14 and 7 — but should fire once, as "7".
    expect(selectExpiryAlertKind(5, leads)).toBe('expiry_7');
  });

  it('matches a threshold exactly', () => {
    expect(selectExpiryAlertKind(30, leads)).toBe('expiry_30');
  });

  it('stays silent outside every window', () => {
    expect(selectExpiryAlertKind(120, leads)).toBeNull();
  });

  it('reports an expired domain distinctly', () => {
    expect(selectExpiryAlertKind(-3, leads)).toBe('expired');
  });
});

describe('parseMoneyToCents', () => {
  it.each([
    ['12.99', 1299],
    ['12,99', 1299],
    ['€12.99', 1299],
    ['0', 0],
    ['15', 1500],
  ])('parses %s', (input, expected) => {
    expect(parseMoneyToCents(input)).toBe(expected);
  });

  it('returns null for junk', () => {
    expect(parseMoneyToCents('abc')).toBeNull();
    expect(parseMoneyToCents('')).toBeNull();
  });
});

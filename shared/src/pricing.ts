/**
 * Cost model.
 *
 * The IONOS API exposes no pricing whatsoever, so every number here comes from
 * the user: a per-TLD price table with optional per-domain overrides.
 *
 * Money is always an integer count of minor units (cents) plus an ISO-4217
 * currency. Never floats, never `numeric` strings — this module runs on both
 * the server and the client (the dashboard recomputes totals locally when you
 * change a filter) and string/float money would rot in transit.
 */

export interface Money {
  cents: number;
  currency: string;
}

export type PriceSource = 'override' | 'tld' | 'unknown';

export interface TldPriceDTO {
  id: string;
  /** Lowercased, no leading dot. */
  tld: string;
  renewalCents: number;
  registrationCents: number | null;
  transferCents: number | null;
  currency: string;
  /** Billing term the renewal price covers. Almost always 12. */
  termMonths: number;
  source: 'manual' | 'seed';
  notes: string | null;
  updatedAt: string;
}

export interface EffectivePrice {
  source: PriceSource;
  renewalCents: number | null;
  currency: string | null;
  termMonths: number;
  /** renewalCents normalised to a 12-month figure. */
  annualizedCents: number | null;
  /**
   * True when this domain is priced in a currency other than the portfolio's
   * base currency. Such domains are excluded from every total rather than
   * converted — see `sumAnnualized`.
   */
  currencyMismatch: boolean;
}

export const DEFAULT_TERM_MONTHS = 12;

/** Minimal shape `resolveEffectivePrice` needs; both DTOs and DB rows satisfy it. */
export interface PriceableDomain {
  tld: string;
  priceOverrideCents: number | null;
  priceCurrency: string | null;
  termMonthsOverride: number | null;
}

/**
 * Resolution chain: per-domain override → TLD table → unknown.
 *
 * An "unknown" price is surfaced explicitly everywhere rather than treated as
 * zero. Silently summing missing prices as 0 produces a total that looks
 * authoritative and is wrong.
 */
export function resolveEffectivePrice(
  domain: PriceableDomain,
  tldPrice: TldPriceDTO | null | undefined,
  baseCurrency: string,
): EffectivePrice {
  if (domain.priceOverrideCents !== null && domain.priceCurrency) {
    const termMonths = domain.termMonthsOverride ?? tldPrice?.termMonths ?? DEFAULT_TERM_MONTHS;
    return {
      source: 'override',
      renewalCents: domain.priceOverrideCents,
      currency: domain.priceCurrency,
      termMonths,
      annualizedCents: annualize(domain.priceOverrideCents, termMonths),
      currencyMismatch: domain.priceCurrency !== baseCurrency,
    };
  }

  if (tldPrice) {
    const termMonths = domain.termMonthsOverride ?? tldPrice.termMonths ?? DEFAULT_TERM_MONTHS;
    return {
      source: 'tld',
      renewalCents: tldPrice.renewalCents,
      currency: tldPrice.currency,
      termMonths,
      annualizedCents: annualize(tldPrice.renewalCents, termMonths),
      currencyMismatch: tldPrice.currency !== baseCurrency,
    };
  }

  return {
    source: 'unknown',
    renewalCents: null,
    currency: null,
    termMonths: domain.termMonthsOverride ?? DEFAULT_TERM_MONTHS,
    annualizedCents: null,
    currencyMismatch: false,
  };
}

export function annualize(cents: number, termMonths: number): number {
  if (termMonths <= 0) return cents;
  return Math.round((cents * 12) / termMonths);
}

export interface AnnualizedTotal {
  totalCents: number;
  currency: string;
  /** Domains counted in `totalCents`. */
  countedDomains: number;
  /** Priced, but in a different currency — deliberately not converted. */
  excludedForCurrency: number;
  /** No price known at all. */
  unknownPrice: number;
}

/**
 * Sums annualised cost across domains.
 *
 * Deliberately performs no FX conversion. Applying an unpinned exchange rate
 * yields a number nobody can audit or reconcile against an invoice; refusing to
 * sum and saying so ("3 domains excluded (USD)") is the honest alternative.
 */
export function sumAnnualized(
  prices: readonly EffectivePrice[],
  baseCurrency: string,
): AnnualizedTotal {
  let totalCents = 0;
  let countedDomains = 0;
  let excludedForCurrency = 0;
  let unknownPrice = 0;

  for (const price of prices) {
    if (price.annualizedCents === null || price.currency === null) {
      unknownPrice++;
    } else if (price.currency !== baseCurrency) {
      excludedForCurrency++;
    } else {
      totalCents += price.annualizedCents;
      countedDomains++;
    }
  }

  return { totalCents, currency: baseCurrency, countedDomains, excludedForCurrency, unknownPrice };
}

/** e.g. 1299 EUR -> "€12.99" */
export function formatMoney(
  cents: number | null | undefined,
  currency: string | null | undefined,
  locale = 'en-US',
): string {
  if (cents === null || cents === undefined || !currency) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Parses "12.99", "12,99", "€12.99" into cents. Returns null if unparseable. */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[^\d.,-]/g, '').replace(',', '.');
  if (cleaned === '' || cleaned === '-') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

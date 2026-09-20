/**
 * Domain availability.
 *
 * The one place this app looks outward at names it does *not* own. It stays a
 * read — nothing here registers anything — which is why it fits alongside a
 * registrar abstraction documented as deliberately read-only.
 */

export interface DomainAvailabilityDTO {
  /** Lowercased, echoed back so results can be rendered in query order. */
  name: string;
  available: boolean;
  /**
   * False when the registrar answered from a cache rather than the registry.
   * A non-definitive "available" is a hint, not a reservation.
   */
  definitive: boolean;
  /**
   * Registration price in minor units, matching the money convention used
   * everywhere else in this app. Null when the registrar quoted no price.
   */
  priceCents: number | null;
  /** ISO-4217, null whenever `priceCents` is null. */
  currency: string | null;
  /** The registration term `priceCents` covers. */
  periodYears: number | null;
  /** Per-name failure (unsupported TLD, malformed name). The row is then unusable. */
  error: string | null;
  /**
   * Set when the name is already in the tracked portfolio. Lets the UI say
   * "you already own this" instead of reporting it as merely unavailable.
   */
  ownedDomainId: string | null;
}

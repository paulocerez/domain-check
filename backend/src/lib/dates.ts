import { differenceInCalendarDays } from 'date-fns';
import { TZDate } from '@date-fns/tz';

/**
 * Timezone-aware day math.
 *
 * Every "days left" figure in this app — the table pills, the urgency colours,
 * and crucially which alert fires — is a *calendar* day count in the user's
 * configured timezone, not a UTC one. A domain expiring at 00:30 Berlin time
 * reads as "tomorrow" in Berlin and "today" in UTC, and an alert that fires on
 * the wrong side of that boundary quietly erodes trust in the whole tool.
 */

/** Calendar days from today (in `timezone`) until `date`. Negative = past. */
export function daysUntil(date: Date, timezone: string): number {
  return differenceInCalendarDays(new TZDate(date, timezone), new TZDate(new Date(), timezone));
}

/** Midnight of `date`'s calendar day in `timezone`, as an absolute instant. */
export function startOfDayInZone(date: Date, timezone: string): Date {
  const zoned = new TZDate(date, timezone);
  zoned.setHours(0, 0, 0, 0);
  return new Date(zoned.getTime());
}

/** 'YYYY-MM-DD' for `date` as seen in `timezone`. Used as the alert dedupe key. */
export function dateKeyInZone(date: Date, timezone: string): string {
  const zoned = new TZDate(date, timezone);
  const year = zoned.getFullYear();
  const month = String(zoned.getMonth() + 1).padStart(2, '0');
  const day = String(zoned.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 'YYYY-MM' bucket used by the renewal calendar. */
export function monthKeyInZone(date: Date, timezone: string): string {
  return dateKeyInZone(date, timezone).slice(0, 7);
}

/** The next `count` month keys starting from this month. */
export function upcomingMonthKeys(count: number, timezone: string): string[] {
  const now = new TZDate(new Date(), timezone);
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    const month = new TZDate(now.getFullYear(), now.getMonth() + i, 1, timezone);
    keys.push(`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

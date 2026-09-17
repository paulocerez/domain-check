import { formatDistanceToNowStrict } from 'date-fns';
import type { ExpiryUrgency } from '@domain-check/shared';

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-CA'); // YYYY-MM-DD — sortable and unambiguous
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return 'never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'never';
  return `${formatDistanceToNowStrict(date)} ago`;
}

/** Compact "days left" label for the table pill. */
export function formatDaysLeft(daysLeft: number | null): string {
  if (daysLeft === null) return '—';
  if (daysLeft < 0) return `${Math.abs(daysLeft)}d ago`;
  if (daysLeft === 0) return 'today';
  if (daysLeft === 1) return '1d';
  if (daysLeft < 100) return `${daysLeft}d`;
  return `${Math.round(daysLeft / 30)}mo`;
}

/**
 * Urgency is the only thing in this UI allowed to use colour semantically, so
 * these classes are the single source for it.
 */
export const URGENCY_CLASS: Record<ExpiryUrgency, string> = {
  expired: 'text-urgent bg-urgent/10 border-urgent/25',
  critical: 'text-urgent bg-urgent/10 border-urgent/25',
  warning: 'text-warning bg-warning/10 border-warning/25',
  ok: 'text-secondary bg-muted border-border',
  unknown: 'text-disabled bg-transparent border-border',
};

export const URGENCY_DOT: Record<ExpiryUrgency, string> = {
  expired: 'bg-urgent',
  critical: 'bg-urgent',
  warning: 'bg-warning',
  ok: 'bg-positive/60',
  unknown: 'bg-disabled',
};

export function formatMonthLabel(month: string): string {
  const [year, m] = month.split('-');
  if (!year || !m) return month;
  const date = new Date(Number(year), Number(m) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short' });
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

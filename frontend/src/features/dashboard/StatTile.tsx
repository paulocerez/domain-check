import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * A KPI tile.
 *
 * One number, one label, one optional sub-line — no sparklines, no icons, no
 * gradient. The row's job is to be readable in one pass; anything more competes
 * with the charts underneath.
 */
export function StatTile({
  label,
  value,
  sub,
  tone = 'neutral',
  to,
  progress,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: 'neutral' | 'urgent' | 'warning' | 'accent';
  to?: string;
  /** 0–1. Renders a hairline bar along the bottom edge. */
  progress?: number;
}) {
  const body = (
    <>
      <p className="label-eyebrow">{label}</p>
      <p
        className={cn(
          'tabular mt-1.5 text-2xl font-semibold leading-none',
          tone === 'urgent' && 'text-urgent',
          tone === 'warning' && 'text-warning',
          tone === 'accent' && 'text-accent',
          tone === 'neutral' && 'text-primary',
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-1.5 text-[11px] text-tertiary">{sub}</p> : null}
      {progress !== undefined ? (
        <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${Math.round(Math.min(Math.max(progress, 0), 1) * 100)}%` }}
          />
        </div>
      ) : null}
    </>
  );

  const className = cn(
    'flex flex-col rounded-lg border border-border bg-surface p-3.5 transition-colors',
    to && 'hover:border-border-strong hover:bg-surface-raised',
  );

  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

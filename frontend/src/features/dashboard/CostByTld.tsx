import { Link } from 'react-router-dom';
import { formatMoney, type CostByTldDTO } from '@domain-check/shared';
import { EmptyState, Panel, PanelHeader } from '@/components/ui/primitives';
import { pluralize } from '@/lib/format';

/**
 * Horizontal bars rather than a pie: comparing lengths against a shared
 * baseline is far easier than comparing angles, and TLD counts run long.
 */
export function CostByTld({ data, currency }: { data: CostByTldDTO[]; currency: string }) {
  const top = data.slice(0, 8);
  const rest = data.slice(8);
  const restTotal = rest.reduce((sum, entry) => sum + entry.annualizedCents, 0);
  const max = Math.max(...top.map((entry) => entry.annualizedCents), restTotal, 1);

  return (
    <Panel>
      <PanelHeader title="Annual cost by TLD" hint={currency} />
      {data.length === 0 ? (
        <EmptyState title="Nothing to cost yet" description="Sync your portfolio to see this." />
      ) : (
        <div className="flex flex-col gap-1.5 p-3">
          {top.map((entry) => (
            <Link
              key={entry.tld}
              to={`/domains?tld=${entry.tld}`}
              className="group flex items-center gap-2.5"
            >
              <span className="w-16 shrink-0 truncate text-[11px] text-secondary">.{entry.tld}</span>
              <div className="h-4 flex-1 overflow-hidden rounded-sm bg-muted">
                <div
                  className="h-full rounded-sm bg-accent/70 transition-[width] group-hover:bg-accent"
                  style={{ width: `${(entry.annualizedCents / max) * 100}%` }}
                />
              </div>
              <span className="tabular w-20 shrink-0 text-right text-[11px] text-secondary">
                {formatMoney(entry.annualizedCents, currency)}
              </span>
              <span className="tabular w-16 shrink-0 text-right text-[11px] text-disabled">
                {entry.unpricedCount > 0
                  ? `${entry.unpricedCount} unpriced`
                  : pluralize(entry.domainCount, 'domain')}
              </span>
            </Link>
          ))}

          {rest.length > 0 ? (
            <div className="flex items-center gap-2.5 pt-1">
              <span className="w-16 shrink-0 text-[11px] text-disabled">
                +{rest.length} more
              </span>
              <div className="h-4 flex-1 overflow-hidden rounded-sm bg-muted">
                <div
                  className="h-full rounded-sm bg-border-strong"
                  style={{ width: `${(restTotal / max) * 100}%` }}
                />
              </div>
              <span className="tabular w-20 shrink-0 text-right text-[11px] text-disabled">
                {formatMoney(restTotal, currency)}
              </span>
              <span className="w-16 shrink-0" />
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

import { useEffect, useRef } from 'react';
import type { DomainDTO } from '@domain-check/shared';
import { formatMoney } from '@domain-check/shared';
import { ArrowDown, ArrowUp, Check, Lock, Minus, Star } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';
import { DomainStatusBadges } from './DomainStatusBadges';
import { formatDate, formatDaysLeft, URGENCY_CLASS } from '@/lib/format';
import { cn } from '@/lib/utils';

export type SortKey = 'name' | 'expiry' | 'cost' | 'tld';

interface Props {
  domains: DomainDTO[];
  selectedIndex: number;
  activeId?: string;
  sort: SortKey;
  dir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  onSelect: (index: number) => void;
  onOpen: (domain: DomainDTO) => void;
  onToggleFavorite: (domain: DomainDTO) => void;
}

// Status carries `w-full` so it absorbs the leftover width. Without it the
// browser hands the slack to Domain, leaving a lake of empty space mid-row.
const COLUMNS: Array<{ key: SortKey | null; label: string; className: string }> = [
  { key: null, label: '', className: 'w-7' },
  { key: 'name', label: 'Domain', className: 'w-[260px]' },
  { key: 'tld', label: 'TLD', className: 'w-20' },
  { key: 'expiry', label: 'Expires', className: 'w-[116px]' },
  { key: null, label: 'Left', className: 'w-20' },
  { key: null, label: 'Renew', className: 'w-16' },
  { key: 'cost', label: 'Cost', className: 'w-24' },
  { key: null, label: 'Status', className: 'w-full min-w-[160px]' },
];

export function DomainsTable({
  domains,
  selectedIndex,
  activeId,
  sort,
  dir,
  onSort,
  onSelect,
  onOpen,
  onToggleFavorite,
}: Props) {
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);

  // Keep the keyboard cursor on screen as j/k move it past the viewport edge.
  useEffect(() => {
    rowRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <table className="w-full border-collapse text-[13px]">
      <thead className="sticky top-0 z-10 bg-background">
        <tr className="border-b border-border">
          {COLUMNS.map((column, index) => (
            <th
              key={`${column.label}-${index}`}
              className={cn(
                'label-eyebrow h-8 px-2.5 text-left font-semibold first:pl-5 last:pr-5',
                column.className,
              )}
            >
              {column.key ? (
                <button
                  onClick={() => onSort(column.key!)}
                  className="flex items-center gap-1 transition-colors hover:text-primary"
                >
                  {column.label}
                  {sort === column.key ? (
                    dir === 'asc' ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowDown className="size-3" />
                    )
                  ) : null}
                </button>
              ) : (
                column.label
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {domains.map((domain, index) => {
          const price = domain.effectivePrice;
          const selected = index === selectedIndex;
          return (
            <tr
              key={domain.id}
              ref={(element) => {
                rowRefs.current[index] = element;
              }}
              onClick={() => {
                onSelect(index);
                onOpen(domain);
              }}
              className={cn(
                'h-8 cursor-pointer border-b border-border/60 transition-colors',
                selected ? 'bg-muted' : 'hover:bg-muted/50',
                domain.id === activeId && 'bg-accent-muted',
                domain.syncState !== 'active' && 'opacity-60',
              )}
            >
              <td className="pl-5">
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleFavorite(domain);
                  }}
                  className="flex size-5 items-center justify-center rounded transition-colors hover:bg-border"
                  aria-label={domain.isFavorite ? 'Remove favourite' : 'Mark favourite'}
                >
                  <Star
                    className={cn(
                      'size-3',
                      domain.isFavorite ? 'fill-warning text-warning' : 'text-disabled',
                    )}
                  />
                </button>
              </td>

              <td className="px-2.5">
                <span className="truncate font-medium text-primary">{domain.name}</span>
                {domain.project ? (
                  <span className="ml-2 text-[11px] text-disabled">{domain.project}</span>
                ) : null}
              </td>

              <td className="px-2.5">
                <Badge variant="outline">.{domain.tld}</Badge>
              </td>

              <td className="tabular whitespace-nowrap px-2.5 text-secondary">
                {formatDate(domain.effectiveExpiry)}
              </td>

              <td className="px-2.5">
                <span
                  className={cn(
                    'tabular inline-flex h-5 items-center rounded border px-1.5 text-[11px] font-medium',
                    URGENCY_CLASS[domain.urgency],
                  )}
                >
                  {formatDaysLeft(domain.daysLeft)}
                </span>
              </td>

              <td className="px-2.5">
                <RenewCell domain={domain} />
              </td>

              <td className="px-2.5">
                {price.renewalCents === null ? (
                  <Tooltip content="No price for this TLD yet. IONOS does not report pricing, so it has to be entered on the Prices page.">
                    <span className="text-[11px] italic text-disabled">set price</span>
                  </Tooltip>
                ) : (
                  <span className="tabular inline-flex items-center gap-1.5 text-secondary">
                    <Tooltip
                      content={
                        price.source === 'override'
                          ? 'Per-domain price override'
                          : `From the .${domain.tld} price table`
                      }
                    >
                      <span
                        className={cn(
                          'size-1.5 rounded-full',
                          price.source === 'override' ? 'bg-accent' : 'bg-border-strong',
                        )}
                      />
                    </Tooltip>
                    {formatMoney(price.renewalCents, price.currency)}
                  </span>
                )}
              </td>

              <td className="px-2.5 pr-5">
                <div className="flex items-center gap-1">
                  <DomainStatusBadges domain={domain} compact />
                  {domain.tags.map((tag) => (
                    <Badge key={tag} variant="neutral">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RenewCell({ domain }: { domain: DomainDTO }) {
  const locked = domain.domainLock || domain.transferLock;
  if (domain.autoRenew === null) {
    return (
      <Tooltip content="Unknown — this domain has not had a full detail sync yet.">
        <Minus className="size-3 text-disabled" />
      </Tooltip>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Tooltip content={domain.autoRenew ? 'Auto-renew is on' : 'Auto-renew is OFF — this will expire'}>
        {domain.autoRenew ? (
          <Check className="size-3 text-positive" />
        ) : (
          <span className="flex items-center gap-1 text-warning">
            <Minus className="size-3" />
          </span>
        )}
      </Tooltip>
      {locked ? <Lock className="size-3 text-disabled" /> : null}
    </div>
  );
}

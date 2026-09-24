import { useEffect, useRef } from 'react';
import type { DomainDTO } from '@domain-check/shared';
import { formatMoney } from '@domain-check/shared';
import { ArrowDown, ArrowUp, Star } from 'lucide-react';
import { Badge, Segmented } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';
import { DomainStatusBadges } from './DomainStatusBadges';
import { RegistrarLogo } from './RegistrarLogo';
import type { SortKey } from './DomainsTable';
import { formatDate, formatDaysLeft, URGENCY_CLASS } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The domains list at phone width.
 *
 * The table this replaces needs ~960px for its nine columns, so below `md` each
 * domain becomes a three-line card instead. Props are deliberately identical to
 * `DomainsTable` so the page only picks between the two.
 */
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

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'name', label: 'Domain' },
  { key: 'expiry', label: 'Expires' },
  { key: 'cost', label: 'Cost' },
  { key: 'tld', label: 'TLD' },
];

export function DomainsCards({
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
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);

  // Same reason as the table: keep the j/k cursor on screen for anyone with a
  // keyboard attached to a small viewport.
  useEffect(() => {
    rowRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div>
      {/* The column headers were the only way to sort, and cards have none. */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background px-3 py-2">
        <span className="label-eyebrow shrink-0">Sort</span>
        <Segmented
          label="Sort domains by"
          value={sort}
          options={SORT_OPTIONS.map((option) => ({
            value: option.key,
            label: (
              <>
                {option.label}
                {sort === option.key ? (
                  dir === 'asc' ? (
                    <ArrowUp className="size-3" />
                  ) : (
                    <ArrowDown className="size-3" />
                  )
                ) : null}
              </>
            ),
          }))}
          onChange={(value) => onSort(value as SortKey)}
        />
      </div>

      <div className="flex flex-col">
        {domains.map((domain, index) => {
          const price = domain.effectivePrice;
          const selected = index === selectedIndex;
          return (
            <div
              key={domain.id}
              ref={(element) => {
                rowRefs.current[index] = element;
              }}
              onClick={() => {
                onSelect(index);
                onOpen(domain);
              }}
              className={cn(
                'flex cursor-pointer flex-col gap-1.5 border-b border-border/60 px-3 py-2.5 transition-colors',
                selected ? 'bg-muted' : 'active:bg-muted/50',
                domain.id === activeId && 'bg-accent-muted',
                domain.syncState !== 'active' && 'opacity-60',
              )}
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleFavorite(domain);
                  }}
                  className="-m-1.5 flex size-9 shrink-0 items-center justify-center rounded transition-colors active:bg-border"
                  aria-label={domain.isFavorite ? 'Remove favourite' : 'Mark favourite'}
                >
                  <Star
                    className={cn(
                      'size-3.5',
                      domain.isFavorite ? 'fill-warning text-warning' : 'text-disabled',
                    )}
                  />
                </button>

                <span className="min-w-0 flex-1 truncate text-[13px]">
                  <span className="font-medium text-primary">{domain.name}</span>
                  {domain.project ? (
                    <span className="ml-2 text-[11px] text-disabled">{domain.project}</span>
                  ) : null}
                </span>

                <span
                  className={cn(
                    'tabular inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[11px] font-medium',
                    URGENCY_CLASS[domain.urgency],
                  )}
                >
                  {formatDaysLeft(domain.daysLeft)}
                </span>
              </div>

              <div className="flex items-center gap-2 pl-6 text-[11px]">
                <Badge variant="outline">.{domain.tld}</Badge>
                <RegistrarLogo kind={domain.registrarKind} label={domain.registrarLabel} />
                <span className="tabular whitespace-nowrap text-secondary">
                  {formatDate(domain.effectiveExpiry)}
                </span>

                <span className="ml-auto shrink-0">
                  {price.renewalCents === null ? (
                    <Tooltip content="No price for this TLD yet. No registrar reports renewal pricing, so it has to be entered on the Prices page.">
                      <span className="italic text-disabled">set price</span>
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
                </span>
              </div>

              <CardBadges domain={domain} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Line three.
 *
 * `compact` is off, unlike the table, because a card has no separate Renew
 * column for the lock icon to live in. Auto-renew earns a badge only when it is
 * off — that is the state worth acting on, and `null` just means this domain has
 * not had a detail sync yet.
 *
 * `empty:hidden` does the work of deciding whether this line exists at all:
 * `DomainStatusBadges` renders nothing when a domain is unremarkable, and a
 * wrapper with no child nodes would otherwise still cost the parent's gap.
 */
function CardBadges({ domain }: { domain: DomainDTO }) {
  return (
    <div className="flex flex-wrap items-center gap-1 pl-6 empty:hidden">
      {domain.autoRenew === false ? <Badge variant="warning">No auto-renew</Badge> : null}
      <DomainStatusBadges domain={domain} />
      {domain.tags.map((tag) => (
        <Badge key={tag} variant="neutral">
          {tag}
        </Badge>
      ))}
    </div>
  );
}

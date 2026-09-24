import { forwardRef } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import type { DomainDTO } from '@domain-check/shared';
import { Badge, Button, Input, Kbd, Segmented } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import type { useDomainFilters } from './useDomainFilters';

const WITHIN_OPTIONS = [
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
] as const;

export const DomainsToolbar = forwardRef<
  HTMLInputElement,
  {
    controls: ReturnType<typeof useDomainFilters>;
    domains: DomainDTO[];
    total: number;
  }
>(function DomainsToolbar({ controls, domains, total }, ref) {
  const { filters, setFilter, toggleInList, clearAll, activeCount, params } = controls;

  // TLD options come from what is actually in the portfolio, so the filter can
  // never offer something that yields zero results.
  const tlds = [...new Set(domains.map((domain) => domain.tld))].sort();
  const tags = [...new Set(domains.flatMap((domain) => domain.tags))].sort();
  const selectedTlds = params.getAll('tld');
  const selectedTags = params.getAll('tag');

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2.5 md:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 basis-full flex-1 max-w-sm md:min-w-[220px] md:basis-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-disabled" />
          <Input
            ref={ref}
            value={filters.q ?? ''}
            onChange={(event) => setFilter('q', event.target.value)}
            placeholder="Search domains, notes, projects…"
            className="pl-8 pr-10"
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
            <Kbd>/</Kbd>
          </span>
        </div>

        <Segmented
          value={params.get('within') ?? ''}
          options={WITHIN_OPTIONS}
          emptyLabel="Any"
          onChange={(value) => setFilter('within', value || undefined)}
          label="Expiring within"
        />

        <Segmented
          value={filters.state ?? 'active'}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'missing', label: 'Missing' },
            { value: 'archived', label: 'Archived' },
            { value: 'all', label: 'All' },
          ]}
          onChange={(value) => setFilter('state', value)}
          label="State"
        />

        <Toggle
          active={params.get('autoRenew') === 'false'}
          onClick={() => setFilter('autoRenew', params.get('autoRenew') === 'false' ? undefined : 'false')}
        >
          Auto-renew off
        </Toggle>

        <Toggle
          active={params.get('priceKnown') === 'false'}
          onClick={() => setFilter('priceKnown', params.get('priceKnown') === 'false' ? undefined : 'false')}
        >
          Unpriced
        </Toggle>

        <Toggle
          active={params.get('favorite') === 'true'}
          onClick={() => setFilter('favorite', params.get('favorite') === 'true' ? undefined : 'true')}
        >
          Favourites
        </Toggle>

        <div className="ml-auto flex w-full items-center justify-end gap-2 text-[11px] text-disabled md:w-auto">
          <SlidersHorizontal className="size-3" />
          <span className="tabular">
            {domains.length === total ? `${total} domains` : `${domains.length} of ${total}`}
          </span>
          {activeCount > 0 ? (
            <Button size="sm" variant="ghost" onClick={clearAll}>
              <X className="size-3" />
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {tlds.length > 1 || tags.length > 0 ? (
        // A portfolio with 17 TLDs wraps to three rows, which on a phone pushes
        // the first domain off the bottom of the screen. One scrolling row
        // instead: the chips stay reachable without owning the viewport.
        <div className="-mx-3 flex snap-x items-center gap-1 overflow-x-auto px-3 pb-0.5 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
          {/* The vertical padding is the tap target — the badge itself is 18px. */}
          {tlds.map((tld) => (
            <button
              key={tld}
              onClick={() => toggleInList('tld', tld)}
              className="shrink-0 snap-start py-1.5 md:py-0"
            >
              <Badge variant={selectedTlds.includes(tld) ? 'accent' : 'outline'}>.{tld}</Badge>
            </button>
          ))}
          {tags.length > 0 ? <span className="mx-1 h-3 w-px shrink-0 bg-border" /> : null}
          {tags.map((tag) => (
            <button
              key={tag}
              onClick={() => toggleInList('tag', tag)}
              className="shrink-0 snap-start py-1.5 md:py-0"
            >
              <Badge variant={selectedTags.includes(tag) ? 'accent' : 'outline'}>#{tag}</Badge>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
});

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'h-9 rounded-md border px-2.5 text-xs transition-colors md:h-8',
        active
          ? 'border-accent/40 bg-accent-muted font-medium text-accent'
          : 'border-border bg-surface text-tertiary hover:text-primary',
      )}
    >
      {children}
    </button>
  );
}

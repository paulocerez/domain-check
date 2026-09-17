import { forwardRef } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import type { DomainDTO } from '@domain-check/shared';
import { Badge, Button, Input, Kbd } from '@/components/ui/primitives';
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
    <div className="flex shrink-0 flex-col gap-2 border-b border-border px-5 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
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

        <div className="ml-auto flex items-center gap-2 text-[11px] text-disabled">
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
        <div className="flex flex-wrap items-center gap-1">
          {tlds.map((tld) => (
            <button key={tld} onClick={() => toggleInList('tld', tld)}>
              <Badge variant={selectedTlds.includes(tld) ? 'accent' : 'outline'}>.{tld}</Badge>
            </button>
          ))}
          {tags.length > 0 ? <span className="mx-1 h-3 w-px bg-border" /> : null}
          {tags.map((tag) => (
            <button key={tag} onClick={() => toggleInList('tag', tag)}>
              <Badge variant={selectedTags.includes(tag) ? 'accent' : 'outline'}>#{tag}</Badge>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
});

function Segmented({
  value,
  options,
  onChange,
  label,
  emptyLabel,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  label: string;
  emptyLabel?: string;
}) {
  const all = emptyLabel ? [{ value: '', label: emptyLabel }, ...options] : options;
  return (
    <div
      role="group"
      aria-label={label}
      className="flex h-8 items-center gap-px rounded-md border border-border bg-surface p-0.5"
    >
      {all.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-[26px] rounded px-2 text-xs transition-colors',
            value === option.value
              ? 'bg-accent-muted font-medium text-accent'
              : 'text-tertiary hover:text-primary',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

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
        'h-8 rounded-md border px-2.5 text-xs transition-colors',
        active
          ? 'border-accent/40 bg-accent-muted font-medium text-accent'
          : 'border-border bg-surface text-tertiary hover:text-primary',
      )}
    >
      {children}
    </button>
  );
}

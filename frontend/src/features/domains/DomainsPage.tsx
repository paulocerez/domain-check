import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { DomainDTO } from '@domain-check/shared';
import { PageHeader } from '@/components/PageHeader';
import { Button, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { DomainDetailSheet } from './DomainDetailSheet';
import { DomainsCards } from './DomainsCards';
import { DomainsTable, type SortKey } from './DomainsTable';
import { DomainsToolbar } from './DomainsToolbar';
import { useDomainFilters } from './useDomainFilters';
import { useDomains, useUpdateDomainById } from '@/api/hooks';
import { useSetupState } from '@/features/setup/useSetupState';
import { useHotkeys } from '@/lib/keyboard';
import { useMediaQuery } from '@/lib/useMediaQuery';

export function DomainsPage() {
  const navigate = useNavigate();
  const { id: activeId } = useParams();
  const controls = useDomainFilters();
  const searchRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [focusPrice, setFocusPrice] = useState(false);

  const query = useDomains(controls.filters);
  const setup = useSetupState();
  // The nine-column table needs ~960px; below that it becomes card rows.
  const compact = useMediaQuery('(max-width: 767px)');
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);

  /**
   * Cost sorting happens here rather than in SQL. The price chain (override ->
   * TLD table -> unknown, annualised) is a shared pure function; expressing it
   * again as an ORDER BY would create a second definition of "what this costs"
   * that can drift from the one every other number uses.
   */
  const domains = useMemo(() => {
    if (controls.filters.sort !== 'cost') return rows;
    const direction = controls.filters.dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const left = a.effectivePrice.annualizedCents;
      const right = b.effectivePrice.annualizedCents;
      // Unpriced domains sort last in both directions — they are not "cheapest".
      if (left === null && right === null) return a.name.localeCompare(b.name);
      if (left === null) return 1;
      if (right === null) return -1;
      return (left - right) * direction || a.name.localeCompare(b.name);
    });
  }, [rows, controls.filters.sort, controls.filters.dir]);

  const selected = domains[Math.min(selectedIndex, domains.length - 1)];
  const updateDomain = useUpdateDomainById();

  const open = (domain: DomainDTO, withPrice = false) => {
    setFocusPrice(withPrice);
    navigate(`/domains/${domain.id}${window.location.search}`);
  };

  const closeSheet = () => {
    setFocusPrice(false);
    navigate(`/domains${window.location.search}`);
  };

  useHotkeys([
    { keys: '/', handler: () => searchRef.current?.focus() },
    { keys: 'j', handler: () => setSelectedIndex((index) => Math.min(index + 1, domains.length - 1)) },
    { keys: 'k', handler: () => setSelectedIndex((index) => Math.max(index - 1, 0)) },
    { keys: 'enter', handler: () => selected && open(selected) },
    { keys: 'e', handler: () => selected && open(selected, true) },
    {
      keys: 'f',
      handler: () =>
        selected && updateDomain.mutate({ id: selected.id, patch: { isFavorite: !selected.isFavorite } }),
    },
  ]);

  const onSort = (key: SortKey) => {
    const sameKey = controls.filters.sort === key;
    // One call, not two: see setFilters — consecutive setFilter calls overwrite
    // each other, which is why picking a column only ever changed direction.
    controls.setFilters({
      sort: key,
      dir: sameKey && controls.filters.dir === 'asc' ? 'desc' : 'asc',
    });
  };

  // Cards and table take the same props on purpose, so the only difference
  // between the two viewports is which one is mounted.
  const List = compact ? DomainsCards : DomainsTable;
  const listProps = {
    domains,
    selectedIndex,
    activeId,
    sort: (controls.filters.sort ?? 'expiry') as SortKey,
    dir: controls.filters.dir ?? 'asc',
    onSort,
    onSelect: setSelectedIndex,
    onOpen: open,
    onToggleFavorite: (domain: DomainDTO) => {
      setSelectedIndex(domains.indexOf(domain));
      updateDomain.mutate({ id: domain.id, patch: { isFavorite: !domain.isFavorite } });
    },
  };

  return (
    <>
      <PageHeader
        title="Domains"
        subtitle={query.data ? `${query.data.meta.total} tracked` : undefined}
      />

      <DomainsToolbar
        ref={searchRef}
        controls={controls}
        domains={rows}
        total={query.data?.meta.total ?? 0}
      />

      <div className="flex-1 overflow-y-auto">
        {query.isLoading ? (
          <div className="flex flex-col gap-px p-3 md:p-5">
            {Array.from({ length: 12 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : domains.length === 0 ? (
          <EmptyState
            // With a filter on, the filter is the explanation. Without one, the
            // reason is a setup state — which registrar variable is unset, or
            // that nothing has synced yet — and saying "run a sync" when a sync
            // cannot start is how this page used to send people looking in the
            // wrong place entirely.
            title={controls.activeCount > 0 ? 'No domains match these filters' : setup.title}
            description={controls.activeCount > 0 ? 'Try clearing a filter.' : setup.description}
            action={
              controls.activeCount === 0 && setup.syncBlocked ? (
                <Button size="sm" variant="secondary" onClick={() => navigate('/settings')}>
                  Open settings
                </Button>
              ) : undefined
            }
          />
        ) : (
          <List {...listProps} />
        )}
      </div>

      <DomainDetailSheet domainId={activeId} onClose={closeSheet} focusPrice={focusPrice} />
    </>
  );
}

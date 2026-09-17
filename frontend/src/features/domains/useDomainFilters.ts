import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DomainFilters } from '@/api/hooks';

/**
 * Filter state lives in the URL, not in React state.
 *
 * That makes a filtered view shareable, survives a reload, and makes the back
 * button behave the way the user expects instead of dumping them out of the
 * page entirely.
 */
export function useDomainFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<DomainFilters>(
    () => ({
      q: params.get('q') ?? undefined,
      tld: params.getAll('tld'),
      tag: params.getAll('tag'),
      state: (params.get('state') as DomainFilters['state']) ?? 'active',
      project: params.get('project') ?? undefined,
      expiringWithinDays: params.get('within') ? Number(params.get('within')) : undefined,
      autoRenew: (params.get('autoRenew') as DomainFilters['autoRenew']) ?? undefined,
      priceKnown: (params.get('priceKnown') as DomainFilters['priceKnown']) ?? undefined,
      favorite: (params.get('favorite') as DomainFilters['favorite']) ?? undefined,
      sort: (params.get('sort') as DomainFilters['sort']) ?? 'expiry',
      dir: (params.get('dir') as DomainFilters['dir']) ?? 'asc',
    }),
    [params],
  );

  const setFilter = useCallback(
    (key: string, value: string | string[] | undefined) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete(key);
          if (Array.isArray(value)) {
            for (const entry of value) next.append(key, entry);
          } else if (value !== undefined && value !== '') {
            next.set(key, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const toggleInList = useCallback(
    (key: string, value: string) => {
      const current = params.getAll(key);
      setFilter(key, current.includes(value) ? current.filter((v) => v !== value) : [...current, value]);
    },
    [params, setFilter],
  );

  const clearAll = useCallback(() => {
    setParams(new URLSearchParams(), { replace: true });
  }, [setParams]);

  const activeCount = useMemo(() => {
    let count = 0;
    for (const key of ['q', 'tld', 'tag', 'project', 'within', 'autoRenew', 'priceKnown', 'favorite']) {
      count += params.getAll(key).length;
    }
    if ((params.get('state') ?? 'active') !== 'active') count += 1;
    return count;
  }, [params]);

  return { filters, setFilter, toggleInList, clearAll, activeCount, params };
}

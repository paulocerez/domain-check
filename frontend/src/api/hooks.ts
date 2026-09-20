import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import type {
  AlertLogDTO,
  AppSettingsDTO,
  CostByTldDTO,
  DomainAvailabilityDTO,
  DomainDTO,
  DomainDetailDTO,
  ExpiryBucketsDTO,
  ExpiryTimelinePointDTO,
  HealthDTO,
  ListMeta,
  RegistrarAccountDTO,
  RenewalCalendarEntryDTO,
  SummaryStatsDTO,
  SyncChangeDTO,
  SyncRunDTO,
  SyncStatusDTO,
  TldPriceDTO,
  UpdateDomainBody,
  UpdateSettingsBody,
  UpsertTldPriceBody,
} from '@domain-check/shared';
import { api, toQueryString } from './client';

export interface DomainFilters {
  q?: string;
  tld?: string[];
  state?: 'active' | 'missing' | 'archived' | 'all';
  tag?: string[];
  project?: string;
  expiringWithinDays?: number;
  autoRenew?: 'true' | 'false';
  priceKnown?: 'true' | 'false';
  favorite?: 'true' | 'false';
  sort?: 'name' | 'expiry' | 'cost' | 'tld' | 'created';
  dir?: 'asc' | 'desc';
}

export const queryKeys = {
  health: ['health'] as const,
  domains: (filters: DomainFilters) => ['domains', filters] as const,
  domain: (id: string) => ['domain', id] as const,
  summary: ['stats', 'summary'] as const,
  costByTld: ['stats', 'cost-by-tld'] as const,
  renewalCalendar: ['stats', 'renewal-calendar'] as const,
  expiryBuckets: ['stats', 'expiry-buckets'] as const,
  expiryTimeline: ['stats', 'expiry-timeline'] as const,
  activity: ['activity'] as const,
  tldPrices: ['tld-prices'] as const,
  accounts: ['registrar-accounts'] as const,
  syncStatus: ['sync', 'status'] as const,
  syncRuns: ['sync', 'runs'] as const,
  syncRun: (id: string) => ['sync', 'run', id] as const,
  settings: ['settings'] as const,
  alerts: ['alerts'] as const,
  availabilitySupport: ['availability', 'support'] as const,
};

type Opts<T> = Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>;

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: async () => (await api.get<HealthDTO>('/health')).data,
    refetchInterval: 60_000,
  });
}

export function useDomains(filters: DomainFilters, options?: Opts<{ rows: DomainDTO[]; meta: ListMeta }>) {
  return useQuery({
    queryKey: queryKeys.domains(filters),
    queryFn: async () => {
      const { data, meta } = await api.get<DomainDTO[], ListMeta>(
        `/domains${toQueryString({ ...filters, limit: 1000 })}`,
      );
      return { rows: data, meta: meta ?? { total: data.length, limit: 1000, offset: 0 } };
    },
    ...options,
  });
}

export function useDomain(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.domain(id ?? ''),
    queryFn: async () => (await api.get<DomainDetailDTO>(`/domains/${id}`)).data,
    enabled: Boolean(id),
  });
}

export function useSummary() {
  return useQuery({
    queryKey: queryKeys.summary,
    queryFn: async () => (await api.get<SummaryStatsDTO>('/stats/summary')).data,
  });
}

export function useCostByTld() {
  return useQuery({
    queryKey: queryKeys.costByTld,
    queryFn: async () => (await api.get<CostByTldDTO[]>('/stats/cost-by-tld')).data,
  });
}

export function useRenewalCalendar() {
  return useQuery({
    queryKey: queryKeys.renewalCalendar,
    queryFn: async () => (await api.get<RenewalCalendarEntryDTO[]>('/stats/renewal-calendar')).data,
  });
}

export function useExpiryBuckets() {
  return useQuery({
    queryKey: queryKeys.expiryBuckets,
    queryFn: async () => (await api.get<ExpiryBucketsDTO>('/stats/expiry-buckets')).data,
  });
}

export function useExpiryTimeline() {
  return useQuery({
    queryKey: queryKeys.expiryTimeline,
    queryFn: async () => (await api.get<ExpiryTimelinePointDTO[]>('/stats/expiry-timeline')).data,
  });
}

export function useActivity(limit = 15) {
  return useQuery({
    queryKey: [...queryKeys.activity, limit],
    queryFn: async () => (await api.get<SyncChangeDTO[]>(`/activity?limit=${limit}`)).data,
  });
}

export function useTldPrices() {
  return useQuery({
    queryKey: queryKeys.tldPrices,
    queryFn: async () => {
      const { data, meta } = await api.get<
        Array<TldPriceDTO & { domainCount: number }>,
        { missingTlds: Array<{ tld: string; domainCount: number }> }
      >('/tld-prices');
      return { prices: data, missingTlds: meta?.missingTlds ?? [] };
    },
  });
}

export function useRegistrarAccounts() {
  return useQuery({
    queryKey: queryKeys.accounts,
    queryFn: async () => (await api.get<RegistrarAccountDTO[]>('/registrar-accounts')).data,
  });
}

/**
 * Polls only while a sync is actually running, then stops on its own. A fixed
 * interval would keep hammering the API all day for a job that runs once.
 */
export function useSyncStatus() {
  return useQuery({
    queryKey: queryKeys.syncStatus,
    queryFn: async () => (await api.get<SyncStatusDTO>('/sync/status')).data,
    refetchInterval: (query) => (query.state.data?.running ? 2000 : false),
  });
}

export function useSyncRuns(limit = 50) {
  return useQuery({
    queryKey: [...queryKeys.syncRuns, limit],
    queryFn: async () => (await api.get<SyncRunDTO[]>(`/sync/runs?limit=${limit}`)).data,
  });
}

export function useSyncRun(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.syncRun(id ?? ''),
    queryFn: async () =>
      (await api.get<{ run: SyncRunDTO; changes: SyncChangeDTO[] }>(`/sync/runs/${id}`)).data,
    enabled: Boolean(id),
  });
}

/**
 * Whether *any* configured account can answer an availability check.
 *
 * Asked of the server rather than derived from `/registrar-accounts`, because
 * the real predicate is four terms — enabled, capable, credentialed, and not
 * overridden by mock mode — and duplicating it here is how the two drift.
 */
export function useAvailabilitySupport() {
  return useQuery({
    queryKey: queryKeys.availabilitySupport,
    queryFn: async () =>
      (await api.get<{ supported: boolean; registrarLabel: string | null }>('/availability/support'))
        .data,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: async () => (await api.get<AppSettingsDTO>('/settings')).data,
  });
}

export function useAlerts(limit = 50) {
  return useQuery({
    queryKey: [...queryKeys.alerts, limit],
    queryFn: async () => (await api.get<AlertLogDTO[]>(`/alerts?limit=${limit}`)).data,
  });
}

// --- mutations --------------------------------------------------------------

/** Everything a price edit can move, so the dashboard updates with it. */
function invalidateCostSurfaces(client: ReturnType<typeof useQueryClient>) {
  client.invalidateQueries({ queryKey: ['domains'] });
  client.invalidateQueries({ queryKey: ['stats'] });
  client.invalidateQueries({ queryKey: queryKeys.tldPrices });
}

export function useUpdateDomain(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (patch: UpdateDomainBody) =>
      (await api.patch<DomainDetailDTO>(`/domains/${id}`, patch)).data,
    onSuccess: (detail) => {
      client.setQueryData(queryKeys.domain(id), detail);
      invalidateCostSurfaces(client);
    },
  });
}

/**
 * Same as `useUpdateDomain` but takes the id per call, for list rows where the
 * target is whichever one you clicked rather than a fixed subject.
 */
export function useUpdateDomainById() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: UpdateDomainBody }) =>
      (await api.patch<DomainDetailDTO>(`/domains/${id}`, patch)).data,
    onSuccess: (detail) => {
      client.setQueryData(queryKeys.domain(detail.id), detail);
      invalidateCostSurfaces(client);
    },
  });
}

export function useRefreshDomain(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post<DomainDetailDTO>(`/domains/${id}/refresh`)).data,
    onSuccess: (detail) => {
      client.setQueryData(queryKeys.domain(id), detail);
      client.invalidateQueries({ queryKey: ['domains'] });
    },
  });
}

export function useArchiveDomain() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) =>
      (await api.post<DomainDetailDTO>(`/domains/${id}/${archived ? 'archive' : 'unarchive'}`)).data,
    onSuccess: (detail) => {
      client.setQueryData(queryKeys.domain(detail.id), detail);
      invalidateCostSurfaces(client);
    },
  });
}

export function useUpsertTldPrice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ tld, body }: { tld: string; body: UpsertTldPriceBody }) =>
      (await api.put<TldPriceDTO>(`/tld-prices/${tld}`, body)).data,
    onSuccess: () => invalidateCostSurfaces(client),
  });
}

export function useDeleteTldPrice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (tld: string) => api.del(`/tld-prices/${tld}`),
    onSuccess: () => invalidateCostSurfaces(client),
  });
}

export function useBulkTldPrices() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      currency: string;
      termMonths: number;
      entries: Array<{ tld: string; renewalCents: number }>;
    }) => (await api.post<{ written: number }>('/tld-prices/bulk', body)).data,
    onSuccess: () => invalidateCostSurfaces(client),
  });
}

export function useStartSync() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (mode: 'full' | 'quick' = 'full') =>
      (await api.post<Array<{ syncRunId: string }>>('/sync', { mode })).data,
    onSuccess: () => {
      // Flip the status query to polling immediately rather than waiting for
      // its next natural refetch.
      client.invalidateQueries({ queryKey: queryKeys.syncStatus });
      client.invalidateQueries({ queryKey: queryKeys.syncRuns });
    },
  });
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (patch: UpdateSettingsBody) =>
      (await api.patch<AppSettingsDTO>('/settings', patch)).data,
    onSuccess: (settings) => {
      client.setQueryData(queryKeys.settings, settings);
      // Base currency and timezone change every derived number.
      client.invalidateQueries({ queryKey: ['stats'] });
      client.invalidateQueries({ queryKey: ['domains'] });
    },
  });
}

/**
 * A mutation rather than a query: it costs an upstream request per call and
 * should fire when the user asks, not when a component happens to mount.
 */
export function useCheckAvailability() {
  return useMutation({
    mutationFn: async (names: string[]) =>
      (await api.post<DomainAvailabilityDTO[]>('/availability', { names })).data,
  });
}

export function useVerifyAccount() {
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post<{ ok: boolean; reason?: string }>(`/registrar-accounts/${id}/verify`)).data,
  });
}

export function useTestAlert() {
  return useMutation({
    mutationFn: async (to?: string) =>
      (await api.post<{ messageId: string | null; transport: string; to: string }>('/alerts/test', { to }))
        .data,
  });
}

export function useRunAlerts() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await api.post<{ claimed: number; sent: boolean; skippedReason?: string }>('/alerts/run')).data,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.alerts }),
  });
}

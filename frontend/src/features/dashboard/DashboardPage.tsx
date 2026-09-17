import { formatMoney } from '@domain-check/shared';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, Skeleton } from '@/components/ui/primitives';
import { ActivityFeed } from './ActivityFeed';
import { CostByTld } from './CostByTld';
import { ExpiryTimeline } from './ExpiryTimeline';
import { RenewalCalendar } from './RenewalCalendar';
import { StatTile } from './StatTile';
import {
  useActivity,
  useCostByTld,
  useExpiryTimeline,
  useRenewalCalendar,
  useSummary,
} from '@/api/hooks';
import { formatRelative, pluralize } from '@/lib/format';

export function DashboardPage() {
  const summary = useSummary();
  const calendar = useRenewalCalendar();
  const costByTld = useCostByTld();
  const timeline = useExpiryTimeline();
  const activity = useActivity(15);

  if (summary.isError) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      </>
    );
  }

  const stats = summary.data;
  const currency = stats?.baseCurrency ?? 'EUR';
  const totalTracked = (stats?.pricedDomains ?? 0) + (stats?.unpricedDomains ?? 0);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={stats ? `synced ${formatRelative(stats.lastSyncAt)}` : undefined}
      />

      <div className="flex-1 overflow-y-auto p-5">
        {!stats ? (
          <div className="grid grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-[88px]" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile
              label="Domains"
              value={String(stats.activeDomains)}
              to="/domains"
              sub={
                stats.missingDomains > 0
                  ? `${stats.missingDomains} no longer at registrar`
                  : stats.archivedDomains > 0
                    ? `${stats.archivedDomains} archived`
                    : 'all accounted for'
              }
            />

            <StatTile
              label="Expiring ≤30d"
              value={String(stats.expiringWithin30Days)}
              tone={stats.expiringWithin30Days > 0 ? 'urgent' : 'neutral'}
              to="/domains?within=30"
              sub={
                stats.expiringWithin7Days > 0
                  ? `${stats.expiringWithin7Days} within a week`
                  : 'nothing urgent'
              }
            />

            <StatTile
              label="Expired"
              value={String(stats.expired)}
              tone={stats.expired > 0 ? 'urgent' : 'neutral'}
              to="/domains?within=0"
              sub={stats.expired > 0 ? 'past their expiry date' : 'none'}
            />

            <StatTile
              label={`Annual spend`}
              value={formatMoney(stats.annualSpendCents, currency)}
              sub={
                stats.annualSpendExcludedForCurrency > 0 ? (
                  // Foreign-currency domains are excluded rather than converted
                  // at a rate nobody could audit — so say so plainly.
                  <span className="text-warning">
                    {stats.annualSpendExcludedForCurrency} excluded (other currency)
                  </span>
                ) : (
                  `across ${pluralize(stats.pricedDomains, 'priced domain')}`
                )
              }
            />

            <StatTile
              label="Auto-renew off"
              value={String(stats.autoRenewOff)}
              tone={stats.autoRenewOff > 0 ? 'warning' : 'neutral'}
              to="/domains?autoRenew=false"
              sub={stats.autoRenewOff > 0 ? 'these will not renew themselves' : 'all set to renew'}
            />

            <StatTile
              label="Price coverage"
              value={`${stats.pricedDomains}/${totalTracked}`}
              tone={stats.unpricedDomains > 0 ? 'warning' : 'neutral'}
              to={stats.unpricedDomains > 0 ? '/prices' : '/domains'}
              progress={totalTracked > 0 ? stats.pricedDomains / totalTracked : 1}
              sub={
                stats.unpricedDomains > 0
                  ? `${stats.unpricedDomains} need a price`
                  : 'every domain is priced'
              }
            />
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
          {calendar.data ? (
            <RenewalCalendar data={calendar.data} currency={currency} />
          ) : (
            <Skeleton className="h-[220px]" />
          )}
          {costByTld.data ? (
            <CostByTld data={costByTld.data} currency={currency} />
          ) : (
            <Skeleton className="h-[220px]" />
          )}
        </div>

        <div className="mt-3">
          {timeline.data ? <ExpiryTimeline data={timeline.data} /> : <Skeleton className="h-[120px]" />}
        </div>

        <div className="mt-3">
          {activity.data ? <ActivityFeed changes={activity.data} /> : <Skeleton className="h-[200px]" />}
        </div>
      </div>
    </>
  );
}

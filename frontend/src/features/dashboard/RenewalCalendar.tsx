import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, type RenewalCalendarEntryDTO } from '@domain-check/shared';
import { Panel, PanelHeader } from '@/components/ui/primitives';
import { formatMonthLabel, pluralize } from '@/lib/format';
import { useMediaQuery } from '@/lib/useMediaQuery';

/**
 * Twelve months of forecast renewal spend.
 *
 * Months with no renewals are kept in the series rather than dropped, so the
 * axis stays continuous and a quiet month reads as quiet instead of compressing
 * the scale. Months containing unpriced renewals are drawn hollow — the cost is
 * unknown, and showing it as a short bar would imply it is small.
 */
export function RenewalCalendar({
  data,
  currency,
}: {
  data: RenewalCalendarEntryDTO[];
  currency: string;
}) {
  const hasAnything = data.some((entry) => entry.domainCount > 0);
  const unpricedMonths = data.filter((entry) => entry.unknownCount > 0).length;
  // Twelve month labels at 11px collide on a phone; show every other one. The
  // Y axis keeps its 44px: the chart's -16px left margin shifts it partly out
  // of the SVG, so a narrower band would clip the tick labels rather than
  // tighten them.
  const compact = useMediaQuery('(max-width: 767px)');

  return (
    <Panel>
      <PanelHeader
        title="Renewal calendar"
        hint={
          unpricedMonths > 0
            ? `${currency} · ${pluralize(unpricedMonths, 'month')} ${unpricedMonths === 1 ? 'contains' : 'contain'} unpriced renewals`
            : `${currency} · next 12 months`
        }
      />
      <div className="h-[180px] p-3">
        {!hasAnything ? (
          <div className="flex h-full items-center justify-center text-xs text-tertiary">
            No renewals due in the next 12 months.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
              <XAxis
                dataKey="month"
                tickFormatter={formatMonthLabel}
                tickLine={false}
                axisLine={false}
                interval={compact ? 1 : undefined}
                tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
              />
              <YAxis
                tickFormatter={(value: number) => (value === 0 ? '' : `${Math.round(value / 100)}`)}
                tickLine={false}
                axisLine={false}
                width={44}
                tick={{ fontSize: 11, fill: 'var(--text-disabled)' }}
              />
              <RechartsTooltip
                cursor={{ fill: 'var(--muted)' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const entry = payload[0]!.payload as RenewalCalendarEntryDTO;
                  return (
                    <div className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-[11px] shadow-lg">
                      <p className="font-medium text-primary">{entry.month}</p>
                      <p className="text-secondary">
                        {pluralize(entry.domainCount, 'renewal')} ·{' '}
                        {formatMoney(entry.totalCents, currency)}
                      </p>
                      {entry.unknownCount > 0 ? (
                        <p className="text-warning">{entry.unknownCount} with no price set</p>
                      ) : null}
                    </div>
                  );
                }}
              />
              <Bar dataKey="totalCents" radius={[2, 2, 0, 0]} maxBarSize={28}>
                {data.map((entry) => (
                  <Cell
                    key={entry.month}
                    fill={entry.unknownCount > 0 ? 'var(--warning)' : 'var(--accent)'}
                    fillOpacity={entry.unknownCount > 0 ? 0.35 : 0.9}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  );
}

import { useNavigate } from 'react-router-dom';
import { formatMoney, type ExpiryTimelinePointDTO } from '@domain-check/shared';
import { EmptyState, Panel, PanelHeader } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';
import { URGENCY_DOT, formatDaysLeft } from '@/lib/format';
import { cn } from '@/lib/utils';

const HORIZON_DAYS = 365;
const MARKERS = [0, 30, 90, 180, 270, 365];
/**
 * `today` and `30d` sit ~8% apart, so all six labels collide on a phone-width
 * track. These two drop out below `sm`, leaving today / 90d / 180d / 365d.
 */
const DENSE_ONLY = new Set([30, 270]);

/**
 * A single 365-day track with one tick per domain.
 *
 * Far denser than a chart for the question actually being asked — "when does
 * the next cluster land, and is any of it red?" — and it scales to a few
 * hundred domains without becoming unreadable.
 */
export function ExpiryTimeline({ data }: { data: ExpiryTimelinePointDTO[] }) {
  const navigate = useNavigate();
  const visible = data.filter((point) => point.daysLeft <= HORIZON_DAYS);
  const overdue = visible.filter((point) => point.daysLeft < 0);

  return (
    <Panel>
      <PanelHeader
        title="Next 12 months"
        hint={overdue.length > 0 ? `${overdue.length} already expired` : `${visible.length} domains`}
      />
      {visible.length === 0 ? (
        <EmptyState title="Nothing expiring within a year" />
      ) : (
        <div className="px-4 pb-3 pt-5">
          <div className="relative h-10">
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
            {visible.map((point) => {
              // Anything already expired is pinned to the left edge rather than
              // pushed off the track.
              const position = (Math.max(point.daysLeft, 0) / HORIZON_DAYS) * 100;
              return (
                <Tooltip
                  key={point.domainId}
                  content={
                    <div>
                      <p className="font-medium text-primary">{point.name}</p>
                      <p className="text-secondary">
                        {formatDaysLeft(point.daysLeft)} ·{' '}
                        {point.renewalCents === null
                          ? 'no price set'
                          : formatMoney(point.renewalCents, point.currency)}
                      </p>
                    </div>
                  }
                >
                  <button
                    onClick={() => navigate(`/domains/${point.domainId}`)}
                    className={cn(
                      'absolute top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform hover:scale-y-150',
                      // Widen the target with a transparent pad rather than the
                      // tick itself — the density is the whole point of this chart.
                      "before:absolute before:-inset-x-1.5 before:-inset-y-2 before:content-['']",
                      URGENCY_DOT[point.urgency],
                    )}
                    style={{ left: `${position}%` }}
                    aria-label={`${point.name}, ${formatDaysLeft(point.daysLeft)}`}
                  />
                </Tooltip>
              );
            })}
          </div>

          <div className="relative mt-1 h-3">
            {MARKERS.map((day) => (
              <span
                key={day}
                className={cn(
                  'absolute -translate-x-1/2 text-[10px] text-disabled',
                  DENSE_ONLY.has(day) && 'hidden sm:inline',
                )}
                style={{ left: `${(day / HORIZON_DAYS) * 100}%` }}
              >
                {day === 0 ? 'today' : `${day}d`}
              </span>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

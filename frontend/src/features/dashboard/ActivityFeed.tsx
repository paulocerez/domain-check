import { Link } from 'react-router-dom';
import type { SyncChangeDTO } from '@domain-check/shared';
import { EmptyState, Panel, PanelHeader } from '@/components/ui/primitives';
import { formatRelative } from '@/lib/format';

const FIELD_LABEL: Record<string, string> = {
  expirationDate: 'expiry',
  autoRenew: 'auto-renew',
  cancelOnExpire: 'cancel on expiry',
  provisioningStatus: 'provisioning',
  processStatus: 'process',
  complianceStatus: 'compliance',
  domainLock: 'domain lock',
  transferLock: 'transfer lock',
};

function describe(change: SyncChangeDTO): string {
  switch (change.changeType) {
    case 'created':
      return 'started being tracked';
    case 'missing':
      return 'no longer returned by the registrar';
    case 'reappeared':
      return 'reappeared at the registrar';
    default:
      break;
  }
  const field = FIELD_LABEL[change.field ?? ''] ?? change.field ?? 'changed';
  let from = shorten(change.oldValue);
  let to = shorten(change.newValue);
  // Shortening a timestamp to its date can make a real change read as "X → X".
  // If that happens, fall back to the full values rather than printing a no-op.
  if (from === to && change.oldValue !== change.newValue) {
    from = change.oldValue ?? '—';
    to = change.newValue ?? '—';
  }
  return `${field}: ${from} → ${to}`;
}

function shorten(value: string | null): string {
  if (!value) return '—';
  // Dates arrive as full ISO strings; only the day matters in a feed.
  const match = /^(\d{4}-\d{2}-\d{2})T/.exec(value);
  return match ? match[1]! : value;
}

export function ActivityFeed({ changes }: { changes: SyncChangeDTO[] }) {
  return (
    <Panel className="flex flex-col">
      <PanelHeader title="Recent changes" />
      {changes.length === 0 ? (
        <EmptyState title="No changes yet" description="Differences found by a sync show up here." />
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {changes.map((change) => (
            <Link
              key={change.id}
              to={`/domains/${change.domainId}`}
              className="flex items-baseline justify-between gap-3 px-4 py-2 transition-colors hover:bg-muted/50"
            >
              <span className="min-w-0 truncate text-[11px]">
                <span className="font-medium text-primary">{change.domainName}</span>{' '}
                <span className="text-tertiary">{describe(change)}</span>
              </span>
              <span className="shrink-0 text-[11px] text-disabled">
                {formatRelative(change.createdAt)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SyncRunDTO } from '@domain-check/shared';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Button, EmptyState, Panel, PanelHeader, Skeleton } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';
import { useStartSync, useSyncRun, useSyncRuns, useSyncStatus } from '@/api/hooks';
import { useSetupState } from '@/features/setup/useSetupState';
import { formatDuration, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_VARIANT = {
  success: 'positive',
  partial: 'warning',
  failed: 'urgent',
  running: 'accent',
} as const;

export function SyncPage() {
  const runs = useSyncRuns(50);
  const status = useSyncStatus();
  const startSync = useStartSync();
  const setup = useSetupState();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string | null>(null);

  const running = status.data?.running ?? false;
  // Offering a button whose only possible outcome is an error toast is worse
  // than offering none: it hides the fact that the problem is configuration.
  const blocked = setup.syncBlocked;

  const trigger = (mode: 'full' | 'quick') =>
    startSync.mutate(mode, {
      onSuccess: () => toast.success(`${mode === 'full' ? 'Full' : 'Quick'} sync started`),
      onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not start'),
    });

  return (
    <>
      <PageHeader
        title="Sync"
        subtitle={running ? 'a sync is running' : undefined}
        actions={
          <>
            <Tooltip
              content={
                blocked
                  ? setup.description
                  : 'Lists the portfolio only — fast, but leaves per-domain detail (auto-renew, locks) untouched.'
              }
            >
              <Button size="sm" disabled={running || blocked} onClick={() => trigger('quick')}>
                Quick
              </Button>
            </Tooltip>
            <Tooltip content={blocked ? setup.description : 'Lists the portfolio and refreshes every domain’s detail.'}>
              <Button
                variant="primary"
                size="sm"
                disabled={running || blocked}
                onClick={() => trigger('full')}
              >
                <RefreshCw className={cn('size-3.5', running && 'animate-spin')} />
                {running ? 'Syncing…' : 'Sync now'}
              </Button>
            </Tooltip>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto p-5">
        {runs.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : !runs.data || runs.data.length === 0 ? (
          <EmptyState
            title={setup.title}
            description={setup.description}
            action={
              blocked ? (
                <Button size="sm" variant="secondary" onClick={() => navigate('/settings')}>
                  Open settings
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => trigger('full')}>
                  Sync now
                </Button>
              )
            }
          />
        ) : (
          <Panel>
            <PanelHeader title="Run history" hint={`last ${runs.data.length}`} />
            <div className="flex flex-col divide-y divide-border">
              {runs.data.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  expanded={expanded === run.id}
                  onToggle={() => setExpanded(expanded === run.id ? null : run.id)}
                />
              ))}
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}

function RunRow({
  run,
  expanded,
  onToggle,
}: {
  run: SyncRunDTO;
  expanded: boolean;
  onToggle: () => void;
}) {
  const detail = useSyncRun(expanded ? run.id : undefined);

  return (
    <div>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40">
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-disabled" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-disabled" />
        )}

        <Badge variant={STATUS_VARIANT[run.status]}>{run.status}</Badge>
        <span className="text-[11px] text-tertiary">
          {run.mode} · {run.trigger}
        </span>

        <span className="tabular ml-auto flex items-center gap-3 text-[11px] text-secondary">
          <Stat label="seen" value={run.domainsSeen} />
          <Stat label="new" value={run.domainsCreated} tone={run.domainsCreated > 0 ? 'accent' : undefined} />
          <Stat label="changed" value={run.domainsUpdated} />
          <Stat
            label="missing"
            value={run.domainsMissing}
            tone={run.domainsMissing > 0 ? 'urgent' : undefined}
          />
          <Stat label="errors" value={run.apiErrors} tone={run.apiErrors > 0 ? 'warning' : undefined} />
          <span className="w-12 text-right text-disabled">{formatDuration(run.durationMs)}</span>
          <span className="w-20 text-right text-disabled">{formatRelative(run.startedAt)}</span>
        </span>
      </button>

      {run.errorMessage ? (
        <p className="px-4 pb-2 pl-11 text-[11px] text-urgent">{run.errorMessage}</p>
      ) : null}

      {run.status === 'partial' ? (
        <p className="px-4 pb-2 pl-11 text-[11px] text-warning">
          Some registrar calls failed, so this run kept every previous value it could not refresh — and
          deliberately did not mark anything as missing.
        </p>
      ) : null}

      {expanded ? (
        <div className="border-t border-border bg-background/50 px-4 py-2 pl-11">
          {detail.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : !detail.data || detail.data.changes.length === 0 ? (
            <p className="py-2 text-[11px] text-disabled">No changes recorded in this run.</p>
          ) : (
            <div className="flex flex-col gap-1 py-1">
              {detail.data.changes.slice(0, 50).map((change) => (
                <div key={change.id} className="flex items-baseline gap-2 text-[11px]">
                  <span className="w-48 shrink-0 truncate text-secondary">{change.domainName}</span>
                  <span className="text-tertiary">
                    {change.field ? (
                      <>
                        {change.field}: <span className="text-disabled">{change.oldValue ?? '—'}</span> →{' '}
                        {change.newValue ?? '—'}
                      </>
                    ) : (
                      change.changeType
                    )}
                  </span>
                </div>
              ))}
              {detail.data.changes.length > 50 ? (
                <p className="pt-1 text-[11px] text-disabled">
                  +{detail.data.changes.length - 50} more
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'accent' | 'urgent' | 'warning';
}) {
  return (
    <span className="w-16 text-right">
      <span
        className={cn(
          tone === 'accent' && 'text-accent',
          tone === 'urgent' && 'text-urgent',
          tone === 'warning' && 'text-warning',
          !tone && 'text-secondary',
        )}
      >
        {value}
      </span>
      <span className="ml-1 text-disabled">{label}</span>
    </span>
  );
}

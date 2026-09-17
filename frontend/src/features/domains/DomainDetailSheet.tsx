import { useEffect, useState } from 'react';
import type { DomainDetailDTO } from '@domain-check/shared';
import { formatMoney, parseMoneyToCents } from '@domain-check/shared';
import { AlertTriangle, Archive, ArchiveRestore, ExternalLink, RefreshCw, Star } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Badge, Button, EmptyState, Input, Separator, Skeleton, Switch, Textarea } from '@/components/ui/primitives';
import { DomainStatusBadges } from './DomainStatusBadges';
import { useArchiveDomain, useDomain, useRefreshDomain, useUpdateDomain } from '@/api/hooks';
import { formatDate, formatDaysLeft, formatRelative, URGENCY_CLASS } from '@/lib/format';
import { cn } from '@/lib/utils';

export function DomainDetailSheet({
  domainId,
  onClose,
  focusPrice,
}: {
  domainId: string | undefined;
  onClose: () => void;
  focusPrice?: boolean;
}) {
  const query = useDomain(domainId);

  return (
    <Sheet open={Boolean(domainId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent title={query.data?.name ?? 'Domain'} className="overflow-y-auto">
        {query.isLoading ? (
          <div className="flex flex-col gap-3 p-5">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : query.data ? (
          <DetailBody domain={query.data} focusPrice={focusPrice} />
        ) : (
          <EmptyState title="Domain not found" description="It may have been deleted." />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({ domain, focusPrice }: { domain: DomainDetailDTO; focusPrice?: boolean }) {
  const update = useUpdateDomain(domain.id);
  const refresh = useRefreshDomain(domain.id);
  const archive = useArchiveDomain();

  return (
    <>
      <header className="shrink-0 border-b border-border px-5 py-4 pr-12">
        <div className="flex items-center gap-2">
          <button
            onClick={() => update.mutate({ isFavorite: !domain.isFavorite })}
            aria-label={domain.isFavorite ? 'Remove favourite' : 'Mark favourite'}
          >
            <Star
              className={cn('size-4', domain.isFavorite ? 'fill-warning text-warning' : 'text-disabled')}
            />
          </button>
          <h2 className="truncate text-[15px] font-semibold text-primary">{domain.name}</h2>
          <span
            className={cn(
              'tabular inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[11px] font-medium',
              URGENCY_CLASS[domain.urgency],
            )}
          >
            {formatDaysLeft(domain.daysLeft)}
          </span>
        </div>

        {domain.encodedName ? (
          <p className="mt-1 font-mono text-[11px] text-disabled">{domain.encodedName}</p>
        ) : null}

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <DomainStatusBadges domain={domain} />
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          <Button
            size="sm"
            onClick={() =>
              refresh.mutate(undefined, {
                onSuccess: () => toast.success('Refreshed from the registrar'),
                onError: (error) =>
                  toast.error(error instanceof Error ? error.message : 'Refresh failed'),
              })
            }
            disabled={refresh.isPending}
          >
            <RefreshCw className={cn('size-3.5', refresh.isPending && 'animate-spin')} />
            Refresh
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href={`https://${domain.name}`} target="_blank" rel="noreferrer noopener">
              <ExternalLink className="size-3.5" />
              Visit
            </a>
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a
              href={`https://who.is/whois/${domain.encodedName ?? domain.name}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              WHOIS
            </a>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() =>
              archive.mutate({ id: domain.id, archived: domain.syncState !== 'archived' })
            }
          >
            {domain.syncState === 'archived' ? (
              <>
                <ArchiveRestore className="size-3.5" />
                Unarchive
              </>
            ) : (
              <>
                <Archive className="size-3.5" />
                Archive
              </>
            )}
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-5 p-5">
        {domain.cancelOnExpire ? (
          <Callout variant="urgent" title="Set to cancel on expiry">
            This domain will not renew. It is scheduled for cancellation
            {domain.cancellationDate ? ` on ${formatDate(domain.cancellationDate)}` : ''}.
          </Callout>
        ) : null}

        {domain.expiryMismatch ? (
          <Callout variant="warning" title="Expiry dates disagree">
            The registrar reports {formatDate(domain.expirationDate)} on the domain record but{' '}
            {formatDate(domain.setToExpireOn)} in its status. This usually means a cancellation or
            transfer is in progress.
          </Callout>
        ) : null}

        {domain.syncState === 'missing' ? (
          <Callout variant="urgent" title="No longer returned by the registrar">
            Last seen {formatRelative(domain.lastSeenAt)}. Your cost data and notes are kept — archive
            it once you have confirmed it is really gone.
          </Callout>
        ) : null}

        <CostSection domain={domain} autoFocus={focusPrice} />
        <RegistrarFacts domain={domain} />
        <AnnotationsSection domain={domain} />
        <HistorySection domain={domain} />
      </div>
    </>
  );
}

function CostSection({ domain, autoFocus }: { domain: DomainDetailDTO; autoFocus?: boolean }) {
  const update = useUpdateDomain(domain.id);
  const price = domain.effectivePrice;
  const [value, setValue] = useState(
    domain.priceOverrideCents !== null ? (domain.priceOverrideCents / 100).toFixed(2) : '',
  );

  useEffect(() => {
    setValue(domain.priceOverrideCents !== null ? (domain.priceOverrideCents / 100).toFixed(2) : '');
  }, [domain.priceOverrideCents]);

  const save = () => {
    const trimmed = value.trim();
    if (trimmed === '') {
      // Clearing the field falls back to the TLD table rather than pinning zero.
      update.mutate({ priceOverrideCents: null, priceCurrency: null });
      return;
    }
    const cents = parseMoneyToCents(trimmed);
    if (cents === null) {
      toast.error(`“${trimmed}” is not a price`);
      return;
    }
    update.mutate(
      { priceOverrideCents: cents, priceCurrency: price.currency ?? 'EUR' },
      { onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not save') },
    );
  };

  return (
    <section>
      <h3 className="label-eyebrow mb-2">Cost</h3>
      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-lg font-semibold text-primary">
            {price.renewalCents === null ? '—' : formatMoney(price.renewalCents, price.currency)}
          </span>
          <Badge variant={price.source === 'override' ? 'accent' : price.source === 'tld' ? 'neutral' : 'outline'}>
            {price.source === 'override'
              ? 'Per-domain override'
              : price.source === 'tld'
                ? `.${domain.tld} table`
                : 'No price set'}
          </Badge>
        </div>

        <p className="mt-1 text-[11px] text-tertiary">
          {price.termMonths === 12
            ? 'per year'
            : `per ${price.termMonths} months · ${formatMoney(price.annualizedCents, price.currency)}/yr`}
        </p>

        {price.currencyMismatch ? (
          <p className="mt-2 text-[11px] text-warning">
            Priced in {price.currency}, which is not your base currency — this domain is excluded from
            portfolio totals rather than converted at a guessed rate.
          </p>
        ) : null}

        <Separator className="my-3" />

        <label className="label-eyebrow" htmlFor="price-override">
          Override
        </label>
        <div className="mt-1.5 flex items-center gap-1.5">
          <Input
            id="price-override"
            autoFocus={autoFocus}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
              if (event.key === 'Escape') event.currentTarget.blur();
            }}
            placeholder={
              price.source === 'tld' ? `${(price.renewalCents! / 100).toFixed(2)} (from TLD)` : '0.00'
            }
            inputMode="decimal"
          />
          <Button size="sm" onClick={save} disabled={update.isPending}>
            Save
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-disabled">
          Leave empty to use the .{domain.tld} price. IONOS does not report pricing, so every figure
          here is yours.
        </p>
      </div>
    </section>
  );
}

function RegistrarFacts({ domain }: { domain: DomainDetailDTO }) {
  const facts: Array<[string, React.ReactNode]> = [
    ['Expires', formatDate(domain.expirationDate ?? domain.setToExpireOn)],
    ['Renews on', formatDate(domain.setToRenewOn)],
    ['Auto-renew', boolLabel(domain.autoRenew)],
    ['Cancel on expiry', boolLabel(domain.cancelOnExpire)],
    ['Domain lock', boolLabel(domain.domainLock)],
    ['Transfer lock', boolLabel(domain.transferLock)],
    ['Privacy', boolLabel(domain.privacyEnabled)],
    ['DNSSEC', boolLabel(domain.dnsSecEnabled)],
    ['Type', domain.domainType ?? '—'],
    ['Provisioning', domain.provisioningStatus ?? '—'],
    ['Registrar', domain.registrarLabel],
  ];

  if (domain.revivePossibleUntil) {
    facts.push(['Revivable until', formatDate(domain.revivePossibleUntil)]);
  }

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="label-eyebrow">From the registrar</h3>
        <span className="text-[11px] text-disabled">
          {domain.detailFetchedAt ? `synced ${formatRelative(domain.detailFetchedAt)}` : 'not yet detailed'}
        </span>
      </div>
      {/* Read-only and dimmed: these are facts we observe, not settings we own. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-border bg-surface p-3">
        {facts.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-2">
            <dt className="text-[11px] text-tertiary">{label}</dt>
            <dd className="truncate text-[11px] text-secondary">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function AnnotationsSection({ domain }: { domain: DomainDetailDTO }) {
  const update = useUpdateDomain(domain.id);
  const [notes, setNotes] = useState(domain.notes ?? '');
  const [project, setProject] = useState(domain.project ?? '');
  const [tagInput, setTagInput] = useState('');

  useEffect(() => setNotes(domain.notes ?? ''), [domain.notes]);
  useEffect(() => setProject(domain.project ?? ''), [domain.project]);

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag || domain.tags.includes(tag)) return setTagInput('');
    update.mutate({ tags: [...domain.tags, tag] });
    setTagInput('');
  };

  return (
    <section>
      <h3 className="label-eyebrow mb-2">Your notes</h3>
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
        <div>
          <label className="text-[11px] text-tertiary" htmlFor="project">
            Project
          </label>
          <Input
            id="project"
            value={project}
            onChange={(event) => setProject(event.target.value)}
            onBlur={() => project !== (domain.project ?? '') && update.mutate({ project: project || null })}
            placeholder="e.g. Brand, Client X"
            className="mt-1"
          />
        </div>

        <div>
          <span className="text-[11px] text-tertiary">Tags</span>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {domain.tags.map((tag) => (
              <button
                key={tag}
                onClick={() => update.mutate({ tags: domain.tags.filter((t) => t !== tag) })}
                title="Remove tag"
              >
                <Badge variant="neutral">{tag} ×</Badge>
              </button>
            ))}
            <Input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && addTag()}
              onBlur={addTag}
              placeholder="Add tag…"
              className="h-6 w-24 px-1.5 text-[11px]"
            />
          </div>
        </div>

        <div>
          <label className="text-[11px] text-tertiary" htmlFor="notes">
            Notes
          </label>
          <Textarea
            id="notes"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            onBlur={() => notes !== (domain.notes ?? '') && update.mutate({ notes: notes || null })}
            placeholder="What is this domain for?"
            className="mt-1"
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="text-[11px] text-tertiary" htmlFor="alerts-enabled">
            Expiry alerts
          </label>
          <Switch
            id="alerts-enabled"
            checked={domain.alertsEnabled}
            onCheckedChange={(checked) => update.mutate({ alertsEnabled: checked })}
          />
        </div>
      </div>
    </section>
  );
}

function HistorySection({ domain }: { domain: DomainDetailDTO }) {
  if (domain.recentChanges.length === 0 && domain.recentAlerts.length === 0) return null;

  return (
    <section>
      <h3 className="label-eyebrow mb-2">History</h3>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
        {domain.recentChanges.slice(0, 8).map((change) => (
          <div key={change.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
            <span className="text-[11px] text-secondary">
              {change.field ? (
                <>
                  <span className="text-tertiary">{change.field}</span>{' '}
                  <span className="text-disabled line-through">{change.oldValue ?? '—'}</span> →{' '}
                  {change.newValue ?? '—'}
                </>
              ) : (
                change.changeType
              )}
            </span>
            <span className="shrink-0 text-[11px] text-disabled">{formatRelative(change.createdAt)}</span>
          </div>
        ))}
        {domain.recentAlerts.slice(0, 5).map((alert) => (
          <div key={`a${alert.id}`} className="flex items-baseline justify-between gap-3 px-3 py-2">
            <span className="text-[11px] text-secondary">Alert sent · {alert.alertKind}</span>
            <span className="shrink-0 text-[11px] text-disabled">{formatRelative(alert.sentAt)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Callout({
  variant,
  title,
  children,
}: {
  variant: 'urgent' | 'warning';
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex gap-2 rounded-lg border p-3',
        variant === 'urgent' ? 'border-urgent/25 bg-urgent/10' : 'border-warning/25 bg-warning/10',
      )}
    >
      <AlertTriangle className={cn('mt-px size-3.5 shrink-0', variant === 'urgent' ? 'text-urgent' : 'text-warning')} />
      <div>
        <p className={cn('text-xs font-medium', variant === 'urgent' ? 'text-urgent' : 'text-warning')}>
          {title}
        </p>
        <p className="mt-0.5 text-[11px] text-secondary">{children}</p>
      </div>
    </div>
  );
}

function boolLabel(value: boolean | null): React.ReactNode {
  if (value === null) return <span className="text-disabled">unknown</span>;
  return value ? 'yes' : 'no';
}

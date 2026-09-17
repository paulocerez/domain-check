import { useEffect, useState } from 'react';
import type { AppSettingsDTO } from '@domain-check/shared';
import { Check, Send, ShieldCheck, ShieldX, X } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/PageHeader';
import {
  Badge,
  Button,
  Input,
  Panel,
  PanelHeader,
  Separator,
  Skeleton,
  Switch,
} from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';
import {
  useAlerts,
  useRegistrarAccounts,
  useRunAlerts,
  useSettings,
  useTestAlert,
  useUpdateSettings,
  useVerifyAccount,
} from '@/api/hooks';
import { formatRelative } from '@/lib/format';

export function SettingsPage() {
  const settings = useSettings();

  return (
    <>
      <PageHeader title="Settings" />
      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {settings.data ? <GeneralPanel settings={settings.data} /> : <Skeleton className="h-64" />}
          {settings.data ? <AlertsPanel settings={settings.data} /> : <Skeleton className="h-64" />}
          <AccountsPanel />
          <AlertHistoryPanel />
        </div>
      </div>
    </>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[13px] text-primary">{label}</p>
        {hint ? <p className="mt-0.5 text-[11px] text-tertiary">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function GeneralPanel({ settings }: { settings: AppSettingsDTO }) {
  const update = useUpdateSettings();
  const [currency, setCurrency] = useState(settings.baseCurrency);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [cron, setCron] = useState(settings.syncCron);

  useEffect(() => setCurrency(settings.baseCurrency), [settings.baseCurrency]);
  useEffect(() => setTimezone(settings.timezone), [settings.timezone]);
  useEffect(() => setCron(settings.syncCron), [settings.syncCron]);

  const save = (patch: Parameters<typeof update.mutate>[0]) =>
    update.mutate(patch, {
      onSuccess: () => toast.success('Saved'),
      onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not save'),
    });

  return (
    <Panel>
      <PanelHeader title="General" />
      <div className="flex flex-col divide-y divide-border">
        <Row
          label="Base currency"
          hint="Domains priced in another currency are excluded from totals rather than converted at a guessed rate."
        >
          <Input
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            onBlur={() => currency !== settings.baseCurrency && save({ baseCurrency: currency })}
            className="w-24 text-center uppercase"
            maxLength={3}
          />
        </Row>

        <Row
          label="Timezone"
          hint="Decides which calendar day a domain expires on — and therefore which alert fires."
        >
          <Input
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            onBlur={() => timezone !== settings.timezone && save({ timezone })}
            className="w-56"
            placeholder="Europe/Berlin"
          />
        </Row>

        <Row label="Sync schedule" hint="Standard cron. Restart the server for a change to take effect.">
          <Input
            value={cron}
            onChange={(event) => setCron(event.target.value)}
            onBlur={() => cron !== settings.syncCron && save({ syncCron: cron })}
            className="w-40 font-mono"
            placeholder="0 6 * * *"
          />
        </Row>
      </div>
    </Panel>
  );
}

function AlertsPanel({ settings }: { settings: AppSettingsDTO }) {
  const update = useUpdateSettings();
  const testAlert = useTestAlert();
  const runAlerts = useRunAlerts();
  const [to, setTo] = useState(settings.alertEmailTo ?? '');
  const [from, setFrom] = useState(settings.alertEmailFrom ?? '');
  const [leadInput, setLeadInput] = useState('');

  useEffect(() => setTo(settings.alertEmailTo ?? ''), [settings.alertEmailTo]);
  useEffect(() => setFrom(settings.alertEmailFrom ?? ''), [settings.alertEmailFrom]);

  const addLead = () => {
    const days = Number(leadInput.trim());
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      return toast.error('Enter a whole number of days between 0 and 365');
    }
    setLeadInput('');
    if (settings.alertLeadDays.includes(days)) return;
    update.mutate({ alertLeadDays: [...settings.alertLeadDays, days] });
  };

  return (
    <Panel>
      <PanelHeader title="Expiry alerts" />
      <div className="flex flex-col divide-y divide-border">
        <Row label="Send alerts" hint="One digest per run, grouped by urgency — never one email per domain.">
          <Switch
            checked={settings.alertsEnabled}
            onCheckedChange={(checked) => update.mutate({ alertsEnabled: checked })}
          />
        </Row>

        <Row label="Send to">
          <Input
            value={to}
            onChange={(event) => setTo(event.target.value)}
            onBlur={() => to !== (settings.alertEmailTo ?? '') && update.mutate({ alertEmailTo: to || null })}
            className="w-64"
            placeholder="you@example.com"
            type="email"
          />
        </Row>

        <Row label="Send from" hint="Must be a domain you have verified with Resend.">
          <Input
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            onBlur={() =>
              from !== (settings.alertEmailFrom ?? '') && update.mutate({ alertEmailFrom: from || null })
            }
            className="w-64"
            placeholder="alerts@example.com"
            type="email"
          />
        </Row>

        <div className="px-4 py-3">
          <p className="text-[13px] text-primary">Lead times</p>
          <p className="mt-0.5 text-[11px] text-tertiary">
            Only the tightest threshold a domain has crossed fires, so you get one warning per
            renewal cycle rather than four.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {settings.alertLeadDays.map((days) => (
              <button
                key={days}
                onClick={() =>
                  update.mutate({ alertLeadDays: settings.alertLeadDays.filter((d) => d !== days) })
                }
                title="Remove"
              >
                <Badge variant="accent">
                  {days}d <X className="size-2.5" />
                </Badge>
              </button>
            ))}
            <Input
              value={leadInput}
              onChange={(event) => setLeadInput(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && addLead()}
              placeholder="add…"
              className="h-6 w-16 px-1.5 text-[11px]"
              inputMode="numeric"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 px-4 py-3">
          <Button
            size="sm"
            disabled={testAlert.isPending}
            onClick={() =>
              testAlert.mutate(undefined, {
                onSuccess: (result) =>
                  toast.success(
                    result.transport === 'console'
                      ? 'Written to the server log — set RESEND_API_KEY to send for real'
                      : `Sent to ${result.to}`,
                  ),
                onError: (error) =>
                  toast.error(error instanceof Error ? error.message : 'Could not send'),
              })
            }
          >
            <Send className="size-3.5" />
            Send test digest
          </Button>

          <Button
            size="sm"
            variant="ghost"
            disabled={runAlerts.isPending}
            onClick={() =>
              runAlerts.mutate(undefined, {
                onSuccess: (result) =>
                  toast.success(
                    result.skippedReason ??
                      (result.claimed === 0
                        ? 'Nothing new to alert on'
                        : `${result.claimed} alerts sent`),
                  ),
                onError: (error) =>
                  toast.error(error instanceof Error ? error.message : 'Could not run'),
              })
            }
          >
            Evaluate now
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function AccountsPanel() {
  const accounts = useRegistrarAccounts();
  const verify = useVerifyAccount();

  return (
    <Panel>
      <PanelHeader title="Registrar accounts" />
      {accounts.isLoading ? (
        <Skeleton className="m-4 h-16" />
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {accounts.data?.map((account) => (
            <div key={account.id} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-primary">{account.label}</span>
                <Badge variant="outline">{account.kind}</Badge>
                {account.credentialConfigured ? (
                  <Badge variant="positive">
                    <ShieldCheck className="size-3" />
                    {account.credentialRef} set
                  </Badge>
                ) : (
                  <Tooltip content={`Set ${account.credentialRef} in your .env and restart the server.`}>
                    <Badge variant="urgent">
                      <ShieldX className="size-3" />
                      {account.credentialRef} missing
                    </Badge>
                  </Tooltip>
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  disabled={verify.isPending}
                  onClick={() =>
                    verify.mutate(account.id, {
                      onSuccess: (result) =>
                        result.ok
                          ? toast.success('Credentials accepted')
                          : toast.error(result.reason ?? 'Rejected'),
                      onError: (error) =>
                        toast.error(error instanceof Error ? error.message : 'Verify failed'),
                    })
                  }
                >
                  Verify
                </Button>
              </div>

              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-tertiary">
                <span>{account.domainCount} domains</span>
                <span>synced {formatRelative(account.lastSyncAt)}</span>
                {account.lastSyncStatus ? <span>· {account.lastSyncStatus}</span> : null}
              </div>

              {!account.capabilities.pricing ? (
                <p className="mt-1.5 text-[11px] text-disabled">
                  This registrar's API does not expose pricing, which is why renewal costs are
                  maintained on the Prices page.
                </p>
              ) : null}
            </div>
          ))}
          <div className="px-4 py-3">
            <p className="text-[11px] text-disabled">
              API keys are read from environment variables and never stored in the database or returned
              by the API. This app has no login — do not expose it to the internet.
            </p>
          </div>
        </div>
      )}
    </Panel>
  );
}

function AlertHistoryPanel() {
  const alerts = useAlerts(20);
  if (!alerts.data || alerts.data.length === 0) return null;

  return (
    <Panel>
      <PanelHeader title="Recent alerts" />
      <div className="flex flex-col divide-y divide-border">
        {alerts.data.map((alert) => (
          <div key={alert.id} className="flex items-baseline justify-between gap-3 px-4 py-2">
            <span className="min-w-0 truncate text-[11px]">
              <span className="font-medium text-primary">{alert.domainName}</span>{' '}
              <span className="text-tertiary">{alert.alertKind}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-[11px] text-disabled">
              {alert.status === 'sent' ? <Check className="size-3 text-positive" /> : null}
              {formatRelative(alert.sentAt)}
            </span>
          </div>
        ))}
      </div>
      <Separator />
    </Panel>
  );
}

import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import { formatMoney } from '@domain-check/shared';
import { Globe, Keyboard, LayoutDashboard, RefreshCw, Send, Settings, Tags } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent } from '@/components/ui/sheet';
import { useDomains, useTestAlert } from '@/api/hooks';
import { formatDaysLeft, URGENCY_DOT } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * ⌘K palette: jump to any domain, navigate, or fire an action.
 *
 * Domains are only fetched while the palette is open — the list is otherwise
 * dead weight on every page.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onSync,
  onShowShortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSync: (mode: 'full' | 'quick') => void;
  onShowShortcuts: () => void;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const domains = useDomains({ state: 'all', sort: 'expiry' }, { enabled: open });
  const testAlert = useTestAlert();

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Command palette" className="top-[15%] overflow-hidden p-0">
        <Command label="Command palette" className="flex max-h-[420px] flex-col">
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder="Jump to a domain, or type a command…"
            className="h-11 w-full border-b border-border bg-transparent px-4 text-[13px] text-primary outline-none placeholder:text-disabled"
          />
          <Command.List className="flex-1 overflow-y-auto p-1.5">
            <Command.Empty className="px-3 py-8 text-center text-xs text-tertiary">
              Nothing matches “{search}”.
            </Command.Empty>

            <Group heading="Go to">
              <Item onSelect={() => run(() => navigate('/'))} icon={LayoutDashboard} label="Dashboard" />
              <Item onSelect={() => run(() => navigate('/domains'))} icon={Globe} label="Domains" />
              <Item onSelect={() => run(() => navigate('/prices'))} icon={Tags} label="Prices" />
              <Item onSelect={() => run(() => navigate('/sync'))} icon={RefreshCw} label="Sync history" />
              <Item onSelect={() => run(() => navigate('/settings'))} icon={Settings} label="Settings" />
            </Group>

            <Group heading="Actions">
              <Item onSelect={() => run(() => onSync('full'))} icon={RefreshCw} label="Sync now (full)" />
              <Item
                onSelect={() => run(() => onSync('quick'))}
                icon={RefreshCw}
                label="Quick sync (skip per-domain detail)"
              />
              <Item
                onSelect={() =>
                  run(() =>
                    testAlert.mutate(undefined, {
                      onSuccess: (result) =>
                        toast.success(
                          result.transport === 'console'
                            ? 'Test digest written to the server log (no Resend key set)'
                            : `Test digest sent to ${result.to}`,
                        ),
                      onError: (error) =>
                        toast.error(error instanceof Error ? error.message : 'Could not send'),
                    }),
                  )
                }
                icon={Send}
                label="Send a test alert digest"
              />
              <Item onSelect={() => run(onShowShortcuts)} icon={Keyboard} label="Keyboard shortcuts" />
            </Group>

            {domains.data && domains.data.rows.length > 0 ? (
              <Group heading="Domains">
                {domains.data.rows.map((domain) => (
                  <Command.Item
                    key={domain.id}
                    value={`${domain.name} ${domain.tld} ${domain.tags.join(' ')} ${domain.project ?? ''}`}
                    onSelect={() => run(() => navigate(`/domains/${domain.id}`))}
                    className="flex h-8 cursor-pointer items-center gap-2 rounded px-2.5 text-[13px] text-secondary data-[selected=true]:bg-muted data-[selected=true]:text-primary"
                  >
                    <span className={cn('size-1.5 shrink-0 rounded-full', URGENCY_DOT[domain.urgency])} />
                    <span className="flex-1 truncate">{domain.name}</span>
                    <span className="tabular text-[11px] text-disabled">
                      {formatMoney(domain.effectivePrice.renewalCents, domain.effectivePrice.currency)}
                    </span>
                    <span className="tabular w-12 text-right text-[11px] text-tertiary">
                      {formatDaysLeft(domain.daysLeft)}
                    </span>
                  </Command.Item>
                ))}
              </Group>
            ) : null}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-disabled"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  onSelect,
  icon: Icon,
  label,
}: {
  onSelect: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex h-8 cursor-pointer items-center gap-2 rounded px-2.5 text-[13px] text-secondary data-[selected=true]:bg-muted data-[selected=true]:text-primary"
    >
      <Icon className="size-3.5 shrink-0" />
      {label}
    </Command.Item>
  );
}

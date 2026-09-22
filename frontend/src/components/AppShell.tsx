import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Calendar,
  Globe,
  ScanSearch,
  LayoutDashboard,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Tags,
} from 'lucide-react';
import { toast } from 'sonner';
import { CommandPalette } from '@/components/CommandPalette';
import { ShortcutsDialog } from '@/components/ShortcutsDialog';
import { Badge, Button, Kbd } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';
import { useHealth, useStartSync, useSyncStatus } from '@/api/hooks';
import { useSetupState } from '@/features/setup/useSetupState';
import { useHotkeys } from '@/lib/keyboard';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, chord: 'g h' },
  { to: '/domains', label: 'Domains', icon: Globe, chord: 'g d' },
  { to: '/availability', label: 'Availability', icon: ScanSearch, chord: 'g a' },
  { to: '/prices', label: 'Prices', icon: Tags, chord: 'g p' },
  { to: '/sync', label: 'Sync', icon: RefreshCw, chord: 'g y' },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, chord: 'g s' },
] as const;

export function AppShell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const health = useHealth();
  const syncStatus = useSyncStatus();
  const startSync = useStartSync();
  const setup = useSetupState();

  const running = syncStatus.data?.running ?? false;

  const triggerSync = (mode: 'full' | 'quick' = 'full') => {
    startSync.mutate(mode, {
      onSuccess: () => toast.success(`${mode === 'full' ? 'Full' : 'Quick'} sync started`),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : 'Could not start the sync'),
    });
  };

  useHotkeys([
    { keys: 'mod+k', handler: () => setPaletteOpen((open) => !open), allowInInputs: true },
    { keys: '?', handler: () => setShortcutsOpen(true) },
    { keys: 'g h', handler: () => navigate('/') },
    { keys: 'g d', handler: () => navigate('/domains') },
    { keys: 'g a', handler: () => navigate('/availability') },
    { keys: 'g p', handler: () => navigate('/prices') },
    { keys: 'g y', handler: () => navigate('/sync') },
    { keys: 'g s', handler: () => navigate('/settings') },
  ]);

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside className="flex w-[196px] shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex h-12 items-center gap-2 px-4">
          <div className="size-5 rounded bg-accent" aria-hidden />
          <span className="text-[13px] font-semibold text-primary">Domain Check</span>
        </div>

        <button
          onClick={() => setPaletteOpen(true)}
          className="mx-2 mb-2 flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-left text-xs text-disabled transition-colors hover:border-border-strong hover:text-tertiary"
        >
          <Search className="size-3.5" />
          <span className="flex-1">Search…</span>
          <Kbd>⌘K</Kbd>
        </button>

        <nav className="flex flex-col gap-px px-2">
          {NAV.map(({ to, label, icon: Icon, chord }) => {
            // The active class is computed here rather than via NavLink's
            // function-form className: Radix's `asChild` Slot merges props by
            // concatenating className as a string, which would stringify the
            // function and drop every style on the element.
            const isActive = to === '/' ? pathname === '/' : pathname.startsWith(to);
            return (
              <Tooltip key={to} content={`Go to ${label} · ${chord}`} side="right">
                <NavLink
                  to={to}
                  end={to === '/'}
                  className={cn(
                    'flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] transition-colors',
                    isActive
                      ? 'bg-accent-muted font-medium text-accent'
                      : 'text-secondary hover:bg-muted hover:text-primary',
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                  {label}
                </NavLink>
              </Tooltip>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-border p-3">
          <Tooltip content={setup.syncBlocked ? setup.description : 'Sync every registrar now'} side="top">
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              disabled={running || startSync.isPending || setup.syncBlocked}
              onClick={() => triggerSync('full')}
            >
              <RefreshCw className={cn('size-3.5', running && 'animate-spin')} />
              {running ? 'Syncing…' : 'Sync now'}
            </Button>
          </Tooltip>

          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-disabled">
            <Calendar className="size-3" />
            <span>Synced {formatRelative(health.data?.lastSyncAt)}</span>
          </div>

          {health.data?.registrarMode === 'mock' ? (
            <Tooltip
              content="MOCK_REGISTRAR=1 — this is fixture data. Set it to 0 and provide your registrar's API credentials for your real portfolio."
              side="top"
            >
              <div className="mt-2">
                <Badge variant="warning">Fixture data</Badge>
              </div>
            </Tooltip>
          ) : null}

          {health.data?.db === 'down' ? (
            <div className="mt-2">
              <Badge variant="urgent">Database down</Badge>
            </div>
          ) : null}

          {setup.syncBlocked ? (
            // The one badge that has to be visible from every page: with no
            // usable credentials nothing in the app can work, and the previous
            // symptom was a set of pages that merely looked empty.
            <Tooltip content={setup.description} side="top">
              <NavLink to="/settings" className="mt-2 block">
                <Badge variant="urgent">Not configured</Badge>
              </NavLink>
            </Tooltip>
          ) : null}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onSync={triggerSync}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, type DomainAvailabilityDTO } from '@domain-check/shared';
import { AlertTriangle, Check, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/PageHeader';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
  Textarea,
} from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';
import { useAvailabilitySupport, useCheckAvailability } from '@/api/hooks';
import { pluralize } from '@/lib/format';

/** Matches the server's cap in `availabilityBodySchema`. */
const MAX_NAMES = 50;

/**
 * Splits a pasted blob into names.
 *
 * People paste lists from a spreadsheet, a notes app or a shell one-liner, so
 * any of whitespace, commas and semicolons separate. A leading scheme or a
 * trailing slash is stripped rather than rejected — pasting a URL is an easy
 * mistake and an obvious intent.
 */
function parseNames(input: string): string[] {
  const names = input
    .split(/[\s,;]+/)
    .map((token) => token.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean);
  return [...new Set(names)];
}

export function AvailabilityPage() {
  const support = useAvailabilitySupport();
  const check = useCheckAvailability();
  const [input, setInput] = useState('');

  const names = parseNames(input);
  const tooMany = names.length > MAX_NAMES;

  const submit = () => {
    if (names.length === 0 || tooMany) return;
    check.mutate(names, {
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : 'Could not check these names'),
    });
  };

  return (
    <>
      <PageHeader
        title="Availability"
        subtitle={
          support.data?.registrarLabel
            ? `Checked against ${support.data.registrarLabel}`
            : 'Check whether a name is free to register'
        }
      />

      <div className="flex-1 overflow-y-auto p-3 md:p-5">
        {support.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : support.data?.supported === false ? (
          <Panel>
            <EmptyState
              title="No registrar can check availability"
              description="IONOS does not expose an availability endpoint. Add a GoDaddy account by setting GODADDY_API_KEY and GODADDY_API_SECRET, then run the seed again — or set MOCK_REGISTRAR=1 to try this against fixtures."
            />
          </Panel>
        ) : (
          <div className="flex flex-col gap-3">
            <Panel className="p-3">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  // Enter submits; Shift+Enter keeps its newline, because the
                  // whole point of a textarea here is pasting a list.
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                rows={4}
                placeholder={'vetpal.io\npetrecords.dev, clinicflow.app'}
                className="font-mono"
                aria-label="Domain names to check"
              />

              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
                <span className="text-[11px] text-disabled">
                  {names.length === 0
                    ? 'Separate names with spaces, commas or newlines'
                    : tooMany
                      ? `${names.length} names — check at most ${MAX_NAMES} at a time`
                      : `${pluralize(names.length, 'name')} · Enter to check`}
                </span>
                <Button
                  size="sm"
                  onClick={submit}
                  disabled={names.length === 0 || tooMany || check.isPending}
                >
                  <Search className="size-3.5" />
                  {check.isPending ? 'Checking…' : 'Check'}
                </Button>
              </div>
            </Panel>

            {check.isError ? (
              <Panel>
                <ErrorState error={check.error} onRetry={submit} />
              </Panel>
            ) : check.data ? (
              <ResultsTable results={check.data} />
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}

function ResultsTable({ results }: { results: DomainAvailabilityDTO[] }) {
  if (results.length === 0) {
    return (
      <Panel>
        <EmptyState title="Nothing to show" description="No names were checked." />
      </Panel>
    );
  }

  const availableCount = results.filter((r) => r.available && !r.error).length;

  return (
    <Panel>
      <div className="flex h-9 items-center border-b border-border px-3 text-[11px] text-disabled">
        {availableCount} of {pluralize(results.length, 'name')} available
      </div>
      <table className="w-full text-[13px]">
        <tbody>
          {results.map((result) => (
            <ResultRow key={result.name} result={result} />
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function ResultRow({ result }: { result: DomainAvailabilityDTO }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2 font-mono text-secondary">
        {result.name}
        {/* Four columns need ~300px of fixed width, so the note moves under the
            name on a phone rather than being dropped. */}
        <span className="mt-0.5 block font-sans empty:hidden sm:hidden">
          <Note result={result} />
        </span>
      </td>

      <td className="w-24 px-3 py-2 sm:w-32">
        <StatusBadge result={result} />
      </td>

      <td className="w-24 px-3 py-2 text-right tabular-nums text-secondary sm:w-28">
        {result.priceCents !== null && result.currency ? (
          <Tooltip
            content={`Registration price for ${pluralize(result.periodYears ?? 1, 'year')}. Renewal usually costs more.`}
          >
            <span>{formatMoney(result.priceCents, result.currency)}</span>
          </Tooltip>
        ) : (
          <span className="text-disabled">—</span>
        )}
      </td>

      <td className="hidden px-3 py-2 text-right sm:table-cell">
        <Note result={result} />
      </td>
    </tr>
  );
}

/** Either "already yours" or "the registrar guessed"; usually neither. */
function Note({ result }: { result: DomainAvailabilityDTO }) {
  if (result.ownedDomainId) {
    return (
      <Link to={`/domains/${result.ownedDomainId}`} className="text-xs text-accent hover:underline">
        In your portfolio
      </Link>
    );
  }
  if (!result.definitive && !result.error) {
    return (
      <Tooltip content="The registrar answered from its cache rather than the registry. Re-check before you rely on it.">
        <span className="inline-flex items-center gap-1 text-[11px] text-warning">
          <AlertTriangle className="size-3" />
          Not confirmed
        </span>
      </Tooltip>
    );
  }
  return null;
}

function StatusBadge({ result }: { result: DomainAvailabilityDTO }) {
  if (result.error) {
    return (
      <Tooltip content={result.error}>
        <Badge variant="outline">Can't check</Badge>
      </Tooltip>
    );
  }
  if (result.available) {
    return (
      <Badge variant="positive">
        <Check className="size-3" />
        Available
      </Badge>
    );
  }
  return (
    <Badge variant="neutral">
      <X className="size-3" />
      Taken
    </Badge>
  );
}

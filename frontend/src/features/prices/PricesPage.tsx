import { useState } from 'react';
import { formatMoney, parseMoneyToCents, type TldPriceDTO } from '@domain-check/shared';
import { Info, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/PageHeader';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Panel,
  PanelHeader,
  Skeleton,
  Textarea,
} from '@/components/ui/primitives';
import { Dialog, DialogContent } from '@/components/ui/sheet';
import { Tooltip } from '@/components/ui/tooltip';
import {
  useBulkTldPrices,
  useDeleteTldPrice,
  useSettings,
  useTldPrices,
  useUpsertTldPrice,
} from '@/api/hooks';
import { pluralize } from '@/lib/format';

export function PricesPage() {
  const query = useTldPrices();
  const settings = useSettings();
  const [bulkOpen, setBulkOpen] = useState(false);
  const currency = settings.data?.baseCurrency ?? 'EUR';

  return (
    <>
      <PageHeader
        title="Prices"
        subtitle="No registrar reports renewal pricing, so these are yours to maintain"
        actions={
          <Button size="sm" onClick={() => setBulkOpen(true)}>
            <Plus className="size-3.5" />
            Bulk paste
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-3 md:p-5">
        {query.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="flex flex-col gap-3">
            {query.data && query.data.missingTlds.length > 0 ? (
              <MissingTlds tlds={query.data.missingTlds} currency={currency} />
            ) : null}
            <PriceTable prices={query.data?.prices ?? []} />
          </div>
        )}
      </div>

      <BulkDialog open={bulkOpen} onOpenChange={setBulkOpen} currency={currency} />
    </>
  );
}

/**
 * Pinned above the table: the fastest path through this page should always be
 * "close the gaps", not "scroll a list of TLDs you already priced".
 */
function MissingTlds({
  tlds,
  currency,
}: {
  tlds: Array<{ tld: string; domainCount: number }>;
  currency: string;
}) {
  const upsert = useUpsertTldPrice();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const save = (tld: string) => {
    const cents = parseMoneyToCents(drafts[tld] ?? '');
    if (cents === null) return toast.error('Enter a price first');
    upsert.mutate(
      { tld, body: { renewalCents: cents, currency, termMonths: 12 } },
      {
        onSuccess: () => toast.success(`.${tld} priced`),
        onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not save'),
      },
    );
  };

  return (
    <Panel className="border-warning/25">
      <PanelHeader
        title="Unpriced TLDs in your portfolio"
        hint={`${tlds.length} to go — these domains are excluded from every total`}
      />
      <div className="flex flex-col divide-y divide-border">
        {tlds.map((entry) => (
          <div
            key={entry.tld}
            className="flex flex-col items-start gap-2 px-4 py-2 md:flex-row md:items-center md:gap-3"
          >
            <div className="flex items-center gap-3">
              <Badge variant="warning">.{entry.tld}</Badge>
              <span className="text-[11px] text-tertiary">
                {pluralize(entry.domainCount, 'domain')}
              </span>
            </div>
            <div className="flex w-full items-center gap-1.5 md:ml-auto md:w-auto">
              <Input
                value={drafts[entry.tld] ?? ''}
                onChange={(event) => setDrafts((d) => ({ ...d, [entry.tld]: event.target.value }))}
                onKeyDown={(event) => event.key === 'Enter' && save(entry.tld)}
                placeholder={`0.00 ${currency}`}
                className="h-9 w-full md:h-7 md:w-28"
                inputMode="decimal"
              />
              <Button size="sm" onClick={() => save(entry.tld)} disabled={upsert.isPending}>
                Save
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function PriceTable({ prices }: { prices: Array<TldPriceDTO & { domainCount: number }> }) {
  const upsert = useUpsertTldPrice();
  const remove = useDeleteTldPrice();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const commit = (price: TldPriceDTO) => {
    const cents = parseMoneyToCents(draft);
    setEditing(null);
    if (cents === null || cents === price.renewalCents) return;
    upsert.mutate({
      tld: price.tld,
      body: {
        renewalCents: cents,
        currency: price.currency,
        termMonths: price.termMonths,
        registrationCents: price.registrationCents,
        transferCents: price.transferCents,
      },
    });
  };

  if (prices.length === 0) {
    return <EmptyState title="No prices yet" description="Add one above, or use bulk paste." />;
  }

  return (
    <Panel>
      <PanelHeader title="TLD prices" hint="click a price to edit" />
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border">
            <th className="label-eyebrow h-8 px-3 text-left font-semibold md:px-4">TLD</th>
            <th className="label-eyebrow h-8 px-2.5 text-left font-semibold">Renewal</th>
            {/* Term and Domains are the two columns worth losing at phone width. */}
            <th className="label-eyebrow hidden h-8 px-2.5 text-left font-semibold sm:table-cell">
              Term
            </th>
            <th className="label-eyebrow hidden h-8 px-2.5 text-left font-semibold sm:table-cell">
              Domains
            </th>
            <th className="label-eyebrow h-8 px-2.5 text-left font-semibold">Source</th>
            <th className="h-8 w-10" />
          </tr>
        </thead>
        <tbody>
          {prices.map((price) => (
            <tr key={price.id} className="h-9 border-b border-border/60 hover:bg-muted/40">
              <td className="px-3 md:px-4">
                <Badge variant="outline">.{price.tld}</Badge>
              </td>
              <td className="px-2.5">
                {editing === price.tld ? (
                  <Input
                    autoFocus
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => commit(price)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commit(price);
                      if (event.key === 'Escape') setEditing(null);
                    }}
                    className="h-9 w-24 md:h-6 md:w-28"
                    inputMode="decimal"
                  />
                ) : (
                  <button
                    onClick={() => {
                      setEditing(price.tld);
                      setDraft((price.renewalCents / 100).toFixed(2));
                    }}
                    className="tabular rounded px-1 py-0.5 text-secondary transition-colors hover:bg-muted hover:text-primary"
                  >
                    {formatMoney(price.renewalCents, price.currency)}
                  </button>
                )}
              </td>
              <td className="tabular hidden px-2.5 text-tertiary sm:table-cell">
                {price.termMonths === 12 ? '1 yr' : `${price.termMonths} mo`}
              </td>
              <td className="tabular hidden px-2.5 text-tertiary sm:table-cell">
                {price.domainCount}
              </td>
              <td className="px-2.5">
                {price.source === 'seed' ? (
                  <Tooltip content="An indicative list price seeded on first run — replace it with what you actually pay.">
                    <Badge variant="warning">
                      <Info className="size-3" />
                      estimate
                    </Badge>
                  </Tooltip>
                ) : (
                  <Badge variant="positive">yours</Badge>
                )}
              </td>
              <td className="pr-3 text-right md:pr-4">
                <button
                  onClick={() => remove.mutate(price.tld)}
                  className="rounded p-1 text-disabled transition-colors hover:bg-urgent/10 hover:text-urgent"
                  aria-label={`Delete .${price.tld} price`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function BulkDialog({
  open,
  onOpenChange,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
}) {
  const bulk = useBulkTldPrices();
  const [text, setText] = useState('');

  // Parsed live so the preview shows exactly what will be written, including
  // which lines were skipped and why.
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = lines.map((line) => {
    const [rawTld, rawPrice] = line.split(/[,;\t]|\s{2,}/).map((part) => part?.trim());
    const tld = rawTld?.replace(/^\./, '').toLowerCase();
    const cents = rawPrice ? parseMoneyToCents(rawPrice) : null;
    return { line, tld, cents, valid: Boolean(tld) && cents !== null };
  });
  const valid = parsed.filter((entry) => entry.valid);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Bulk price import" className="p-0">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold text-primary">Bulk price import</h2>
          <p className="mt-0.5 text-[11px] text-tertiary">
            One TLD per line, e.g. <code className="text-secondary">com, 15.00</code>. Prices are read
            as {currency}.
          </p>
        </div>

        <div className="p-4">
          <Textarea
            rows={8}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={'com, 15.00\nde, 12.00\nio, 49.00'}
            className="font-mono text-[12px]"
          />

          {lines.length > 0 ? (
            <p className="mt-2 text-[11px] text-tertiary">
              {valid.length} of {lines.length} lines parsed
              {valid.length < lines.length ? (
                <span className="text-warning">
                  {' '}
                  · {lines.length - valid.length} will be skipped
                </span>
              ) : null}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={valid.length === 0 || bulk.isPending}
            onClick={() =>
              bulk.mutate(
                {
                  currency,
                  termMonths: 12,
                  entries: valid.map((entry) => ({ tld: entry.tld!, renewalCents: entry.cents! })),
                },
                {
                  onSuccess: (result) => {
                    toast.success(`${result.written} prices saved`);
                    setText('');
                    onOpenChange(false);
                  },
                  onError: (error) =>
                    toast.error(error instanceof Error ? error.message : 'Import failed'),
                },
              )
            }
          >
            Import {valid.length > 0 ? valid.length : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

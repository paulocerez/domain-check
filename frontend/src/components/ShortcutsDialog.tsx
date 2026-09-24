import { Dialog, DialogContent } from '@/components/ui/sheet';
import { Kbd } from '@/components/ui/primitives';

const SECTIONS = [
  {
    title: 'Global',
    items: [
      ['⌘K', 'Command palette'],
      ['/', 'Focus search'],
      ['?', 'This dialog'],
      ['Esc', 'Close / go back'],
    ],
  },
  {
    title: 'Navigate',
    items: [
      ['g then h', 'Dashboard'],
      ['g then d', 'Domains'],
      ['g then a', 'Availability'],
      ['g then p', 'Prices'],
      ['g then y', 'Sync history'],
      ['g then s', 'Settings'],
    ],
  },
  {
    title: 'Domain list',
    items: [
      ['j / k', 'Move selection'],
      ['Enter', 'Open selected domain'],
      ['f', 'Toggle favourite'],
      ['e', 'Edit price'],
      ['r', 'Refresh from registrar'],
    ],
  },
] as const;

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Keyboard shortcuts" className="p-0">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold text-primary">Keyboard shortcuts</h2>
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 p-4 sm:grid-cols-2">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <h3 className="label-eyebrow mb-2">{section.title}</h3>
              <dl className="flex flex-col gap-1.5">
                {section.items.map(([keys, description]) => (
                  <div key={keys} className="flex items-center justify-between gap-4">
                    <dt className="text-xs text-secondary">{description}</dt>
                    <dd className="shrink-0">
                      <Kbd>{keys}</Kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

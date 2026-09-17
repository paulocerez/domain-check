import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border px-5">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h1 className="text-[13px] font-semibold text-primary">{title}</h1>
        {subtitle ? <span className="truncate text-xs text-tertiary">{subtitle}</span> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}

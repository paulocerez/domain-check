import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';

/**
 * The UI kit.
 *
 * Deliberately small and hand-written rather than the full shadcn surface: this
 * app needs about eight primitives, and every one of them is tuned for density
 * (28–32px controls, 12–13px type) in a way the defaults are not.
 *
 * That density is a desktop affordance, so every control here is written as a
 * touch-sized mobile value plus an `md:` restore. Desktop renders exactly as it
 * did before; phones get ~40px targets.
 */

// --- Button -----------------------------------------------------------------

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-foreground hover:bg-accent/90',
        secondary: 'bg-surface-raised text-primary border border-border hover:bg-muted',
        ghost: 'text-secondary hover:bg-muted hover:text-primary',
        danger: 'bg-urgent/10 text-urgent border border-urgent/25 hover:bg-urgent/20',
      },
      size: {
        sm: 'h-9 px-3 text-xs md:h-7 md:px-2.5',
        md: 'h-10 px-3.5 text-[13px] md:h-8 md:px-3',
        icon: 'h-9 w-9 md:h-7 md:w-7',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = 'Button';

// --- Input ------------------------------------------------------------------

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        // `text-base` on mobile is not a style choice: iOS Safari zooms the
        // whole viewport when a focused input's font is under 16px.
        'h-10 w-full rounded-md border border-border bg-surface px-2.5 text-base text-primary md:h-8 md:text-[13px]',
        'placeholder:text-disabled focus-visible:border-accent/50 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full rounded-md border border-border bg-surface px-2.5 py-2 text-base text-primary md:text-[13px]',
      'placeholder:text-disabled focus-visible:border-accent/50 resize-y',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

// --- Badge ------------------------------------------------------------------

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] font-medium leading-4 whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'border-border bg-muted text-secondary',
        accent: 'border-accent/25 bg-accent-muted text-accent',
        urgent: 'border-urgent/25 bg-urgent/10 text-urgent',
        warning: 'border-warning/25 bg-warning/10 text-warning',
        positive: 'border-positive/25 bg-positive/10 text-positive',
        outline: 'border-border text-tertiary',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

/**
 * forwardRef is required, not cosmetic: Radix's `asChild` triggers (Tooltip,
 * Dialog) attach a ref to their child, and a plain function component silently
 * drops it — leaving tooltips that never open.
 */
export const Badge = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>
>(({ className, variant, ...props }, ref) => (
  <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
));
Badge.displayName = 'Badge';

// --- Panel ------------------------------------------------------------------

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-surface', className)}
      {...props}
    />
  );
}

export function PanelHeader({
  title,
  action,
  hint,
}: {
  title: string;
  action?: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
      <div className="flex items-baseline gap-2">
        <h2 className="label-eyebrow">{title}</h2>
        {hint ? <span className="text-[11px] text-disabled">{hint}</span> : null}
      </div>
      {action}
    </div>
  );
}

// --- Segmented --------------------------------------------------------------

/**
 * A single-choice control rendered as one connected row of buttons.
 *
 * Shared rather than local because the domains toolbar and the mobile sort bar
 * both need it, and they must look identical — the sort bar is the only way to
 * sort once the table's column headers are gone on a phone.
 *
 * `label` is a ReactNode so a caller can hang a direction arrow off the active
 * option.
 */
export function Segmented({
  value,
  options,
  onChange,
  label,
  emptyLabel,
  className,
}: {
  value: string;
  options: readonly { value: string; label: React.ReactNode }[];
  onChange: (value: string) => void;
  label: string;
  emptyLabel?: string;
  className?: string;
}) {
  const all = emptyLabel ? [{ value: '', label: emptyLabel }, ...options] : options;
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'flex h-11 items-center gap-px rounded-md border border-border bg-surface p-0.5 md:h-8',
        className,
      )}
    >
      {all.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'flex h-9 items-center justify-center gap-1 rounded px-2 text-xs transition-colors md:h-[26px]',
            value === option.value
              ? 'bg-accent-muted font-medium text-accent'
              : 'text-tertiary hover:text-primary',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// --- Misc -------------------------------------------------------------------

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-surface-raised px-1 py-px font-mono text-[10px] leading-4 text-tertiary">
      {children}
    </kbd>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-muted', className)} />;
}

export function Separator({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-border', className)} />;
}

export function Switch({
  checked,
  onCheckedChange,
  id,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        // The 16×28 track is too small to hit on a phone, but growing it would
        // change the look everywhere; an invisible inset pad grows only the
        // target.
        'relative h-4 w-7 shrink-0 rounded-full border transition-colors',
        "after:absolute after:-inset-2 after:content-[''] md:after:inset-0",
        checked ? 'border-accent bg-accent' : 'border-border bg-muted',
      )}
    >
      {/* `left-px` is required: without an explicit inset the knob falls back to
          its static position, which sits at the track's right edge. */}
      <span
        className={cn(
          'absolute left-px top-px size-3 rounded-full bg-white transition-transform',
          checked ? 'translate-x-[12px]' : 'translate-x-0',
        )}
      />
    </button>
  );
}

/**
 * The standard empty state. Every list in the app uses this so "nothing here"
 * always looks deliberate rather than broken.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-[13px] font-medium text-secondary">{title}</p>
      {description ? <p className="max-w-sm text-xs text-tertiary">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-[13px] font-medium text-urgent">Could not load this</p>
      <p className="max-w-md text-xs text-tertiary">{message}</p>
      {onRetry ? (
        <Button size="sm" onClick={onRetry} className="mt-1">
          Retry
        </Button>
      ) : null}
    </div>
  );
}

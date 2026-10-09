/**
 * `journal-ui` for a `react` live block (#558): Button, Card, Tabs, Input, Select, Slider,
 * Switch, Badge and Progress, under the names and props of shadcn/ui, which agents write.
 * vite.config.ts bundles this module into the script that sets window.JournalUI in the
 * frame; the app itself never imports it.
 *
 * The app's own src/components/ui/* lean on classes the frame's fixed Tailwind sheet does not
 * have (`dark:`, `data-[state=…]:`, arbitrary values), so these are thin versions on the same
 * classes where the sheet has them: state is in the class names, and the frame's own form
 * controls (CONTROL_STYLE in liveBlocks.ts) give focus rings and the disabled look. The
 * colours are the frame's theme variables, so light and dark need nothing here.
 */
import { createContext, useContext, useState, type ComponentProps, type ReactNode } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Classes joined, a later one winning over an earlier one of the same kind, as in shadcn/ui. */
function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** A value the block controls, or one kept here from `initial` when it does not. */
function useControllable<T>(value: T | undefined, initial: T, onChange?: (next: T) => void): [T, (next: T) => void] {
  const [own, setOwn] = useState(initial);
  const current = value === undefined ? own : value;
  return [
    current,
    (next) => {
      if (value === undefined) setOwn(next);
      onChange?.(next);
    },
  ];
}

const BUTTON_VARIANTS = {
  default: 'border-0 bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'border-0 bg-secondary text-secondary-foreground hover:opacity-80',
  outline: 'border bg-background hover:bg-accent hover:text-accent-foreground',
  ghost: 'border-0 bg-transparent hover:bg-accent hover:text-accent-foreground',
  destructive: 'border-0 bg-destructive text-destructive-foreground hover:opacity-90',
  link: 'border-0 bg-transparent px-0 text-primary underline hover:opacity-80',
};
const BUTTON_SIZES = { default: 'h-9 px-4 py-2', sm: 'h-8 gap-1.5 px-3', lg: 'h-10 px-6', icon: 'size-9 p-0' };

export function Button({
  className,
  variant = 'default',
  size = 'default',
  type = 'button',
  ...props
}: ComponentProps<'button'> & { variant?: keyof typeof BUTTON_VARIANTS; size?: keyof typeof BUTTON_SIZES }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-4 rounded-lg border bg-card py-4 text-card-foreground', className)} {...props} />;
}
export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5 px-4', className)} {...props} />;
}
export function CardTitle({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('font-semibold leading-none', className)} {...props} />;
}
export function CardDescription({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-4', className)} {...props} />;
}
export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-2 px-4', className)} {...props} />;
}

const TabsContext = createContext<{ value: string; select: (value: string) => void }>({ value: '', select: () => {} });

export function Tabs({
  value,
  defaultValue = '',
  onValueChange,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'defaultValue'> & { value?: string; defaultValue?: string; onValueChange?: (value: string) => void }) {
  const [current, select] = useControllable(value, defaultValue, onValueChange);
  return (
    <TabsContext.Provider value={{ value: current, select }}>
      <div className={cn('flex flex-col gap-2', className)} {...props} />
    </TabsContext.Provider>
  );
}
export function TabsList({ className, ...props }: ComponentProps<'div'>) {
  return <div role="tablist" className={cn('inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-0.5 text-muted-foreground', className)} {...props} />;
}
export function TabsTrigger({ value, className, onClick, ...props }: ComponentProps<'button'> & { value: string }) {
  const tabs = useContext(TabsContext);
  const active = tabs.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-state={active ? 'active' : 'inactive'}
      className={cn(
        'inline-flex h-full flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-sm font-medium transition-colors',
        active ? 'border-border bg-background text-foreground' : 'border-transparent bg-transparent text-muted-foreground hover:text-foreground',
        className,
      )}
      onClick={(event) => {
        tabs.select(value);
        onClick?.(event);
      }}
      {...props}
    />
  );
}
export function TabsContent({ value, className, ...props }: ComponentProps<'div'> & { value: string }) {
  const tabs = useContext(TabsContext);
  return tabs.value === value ? <div role="tabpanel" className={cn('flex-1', className)} {...props} /> : null;
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn('h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-sm', className)} {...props} />;
}

/**
 * The browser's own select, so it needs no popup: `<Select value onValueChange>` with
 * `<SelectItem value>` options. A `placeholder` is shown while nothing is chosen.
 */
export function Select({
  value,
  defaultValue,
  onValueChange,
  placeholder,
  className,
  children,
  onChange,
  ...props
}: Omit<ComponentProps<'select'>, 'value' | 'defaultValue'> & { value?: string; defaultValue?: string; onValueChange?: (value: string) => void; placeholder?: string }) {
  const [current, select] = useControllable(value, defaultValue ?? '', onValueChange);
  return (
    <select
      value={current}
      className={cn('h-9 w-fit rounded-md border bg-transparent px-3 py-1 text-sm', className)}
      onChange={(event) => {
        select(event.target.value);
        onChange?.(event);
      }}
      {...props}
    >
      {placeholder !== undefined && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {children}
    </select>
  );
}
export function SelectItem(props: ComponentProps<'option'> & { value: string; children?: ReactNode }) {
  return <option {...props} />;
}

/** One thumb, with shadcn/ui's array values: `value={[50]} onValueChange={([v]) => …}`. */
export function Slider({
  value,
  defaultValue,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'defaultValue' | 'type' | 'onChange'> & {
  value?: number[];
  defaultValue?: number[];
  onValueChange?: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [current, select] = useControllable(value, defaultValue ?? [min], onValueChange);
  return (
    <input
      {...props}
      type="range"
      min={min}
      max={max}
      step={step}
      value={current[0]}
      className={cn('w-full', className)}
      onChange={(event) => select([Number(event.target.value)])}
    />
  );
}

export function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  className,
  ...props
}: Omit<ComponentProps<'button'>, 'onClick'> & { checked?: boolean; defaultChecked?: boolean; onCheckedChange?: (checked: boolean) => void }) {
  const [on, set] = useControllable(checked, defaultChecked, onCheckedChange);
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={on}
      data-state={on ? 'checked' : 'unchecked'}
      className={cn('inline-flex h-5 w-9 shrink-0 items-center rounded-full border-0 p-0.5 transition-colors', on ? 'bg-primary' : 'bg-border', className)}
      onClick={() => set(!on)}
    >
      <span
        className={cn('pointer-events-none block size-4 rounded-full shadow-sm transition-transform', on ? 'bg-primary-foreground' : 'bg-background')}
        style={{ transform: on ? 'translateX(1rem)' : 'none' }}
      />
    </button>
  );
}

const BADGE_VARIANTS = {
  default: 'border-transparent bg-primary text-primary-foreground',
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  destructive: 'border-transparent bg-destructive text-destructive-foreground',
  outline: 'text-foreground',
};

export function Badge({ className, variant = 'default', ...props }: ComponentProps<'span'> & { variant?: keyof typeof BADGE_VARIANTS }) {
  return (
    <span
      className={cn('inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium', BADGE_VARIANTS[variant], className)}
      {...props}
    />
  );
}

/** `value` from 0 to 100. */
export function Progress({ value = 0, className, ...props }: ComponentProps<'div'> & { value?: number }) {
  const percent = Math.min(100, Math.max(0, value));
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)} {...props}>
      <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
    </div>
  );
}

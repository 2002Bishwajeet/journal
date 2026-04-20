import { cn } from '@/lib/utils';

export interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
  className?: string;
  preventFocusLoss?: boolean;
}

const variantStyles = {
  desktop: {
    base: 'p-2 rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed',
    active: 'bg-accent text-accent-foreground',
  },
  mobile: {
    base: 'flex items-center justify-center w-12 h-12 min-w-12 rounded-lg active:bg-primary/20 touch-manipulation',
    active: 'bg-primary/10 text-primary',
    inactive: 'text-foreground hover:bg-muted',
  },
  bubble: {
    base: 'flex items-center justify-center w-8 h-8 rounded text-popover-foreground hover:bg-accent active:bg-accent/80',
    active: 'bg-accent text-accent-foreground',
  },
} as const;

export type ToolbarVariant = keyof typeof variantStyles;

export function ToolbarButton({
  onClick,
  isActive,
  disabled,
  children,
  title,
  className,
  preventFocusLoss,
  variant = 'desktop',
}: ToolbarButtonProps & { variant?: ToolbarVariant }) {
  const shouldPreventFocusLoss = preventFocusLoss ?? (variant === 'desktop');
  const styles = variantStyles[variant];

  const handleClick = shouldPreventFocusLoss ? undefined : onClick;
  const handleMouseDown = shouldPreventFocusLoss
    ? (e: React.MouseEvent) => {
        e.preventDefault();
        if (!disabled) onClick();
      }
    : undefined;

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      disabled={disabled}
      title={title}
      className={cn(
        'transition-colors',
        styles.base,
        isActive
          ? styles.active
          : ('inactive' in styles ? styles.inactive : ''),
        disabled && 'opacity-50',
        className
      )}
    >
      {children}
    </button>
  );
}

const dividerStyles = {
  desktop: 'w-px h-6 bg-border mx-1',
  mobile: 'w-px h-8 bg-border mx-1 flex-shrink-0',
} as const;

export function ToolbarDivider({ variant = 'desktop' }: { variant?: 'desktop' | 'mobile' }) {
  return <div className={dividerStyles[variant]} />;
}

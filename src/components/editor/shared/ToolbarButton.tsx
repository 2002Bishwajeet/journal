/**
 * Reusable Toolbar Button Component
 * 
 * Used by both EditorToolbar and MobileToolbar for consistent button styling.
 */

import { cn } from '@/lib/utils';

export interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
  className?: string;
  /**
   * If true, uses onMouseDown with preventDefault to avoid losing editor focus.
   * Recommended for desktop toolbar buttons.
   */
  preventFocusLoss?: boolean;
}

export function ToolbarButton({
  onClick,
  isActive,
  disabled,
  children,
  title,
  className,
  preventFocusLoss = true,
}: ToolbarButtonProps) {
  const handleClick = preventFocusLoss
    ? undefined
    : onClick;

  const handleMouseDown = preventFocusLoss
    ? (e: React.MouseEvent) => {
        e.preventDefault(); // Prevent focus loss from editor
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
        'p-2 rounded-md transition-colors',
        'hover:bg-gray-100 dark:hover:bg-gray-800',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        isActive && 'bg-gray-200 dark:bg-gray-700 text-blue-600 dark:text-blue-400',
        className
      )}
    >
      {children}
    </button>
  );
}

export function ToolbarDivider() {
  return <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />;
}

/**
 * Reusable Toolbar Popover Component
 * 
 * Used for link and formula inputs in the toolbar.
 */

import { useState, useCallback } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ToolbarPopoverProps {
  icon: React.ReactNode;
  title: string;
  isActive?: boolean;
  onApply: (value: string) => void;
  placeholder: string;
  defaultValue?: string;
  className?: string;
}

export function ToolbarPopover({
  icon,
  title,
  isActive,
  onApply,
  placeholder,
  defaultValue = '',
  className,
}: ToolbarPopoverProps) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);

  const handleApply = useCallback(() => {
    if (value.trim()) {
      onApply(value);
      setOpen(false);
    }
  }, [value, onApply]);

  // Handle popover open state change - reset value when opening
  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen) {
      setValue(defaultValue);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          className={cn(
            'p-2 rounded-md transition-colors',
            'hover:bg-gray-100 dark:hover:bg-gray-800',
            isActive && 'bg-gray-200 dark:bg-gray-700 text-blue-600 dark:text-blue-400',
            className
          )}
        >
          {icon}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="start">
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleApply();
              }
            }}
            autoFocus
          />
          <Button size="sm" onClick={handleApply}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

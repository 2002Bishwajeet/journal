
import { forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import type { EmojiItem } from './emojiData';

interface EmojiListProps {
  items: EmojiItem[];
  command: (item: { name: string; emoji: string }) => void;
}

export const EmojiList = forwardRef((props: EmojiListProps, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  // Calculate valid selected index - reset to 0 when items change, clamp to valid range
  const validSelectedIndex = useMemo(() => {
    if (props.items.length === 0) return 0;
    return Math.min(selectedIndex, props.items.length - 1);
  }, [selectedIndex, props.items.length]);

  const selectItem = (index: number) => {
    const item = props.items[index];
    if (item) {
      props.command({ name: item.name, emoji: item.emoji });
    }
  };

  const upHandler = () => {
    setSelectedIndex((validSelectedIndex + props.items.length - 1) % props.items.length);
  };

  const downHandler = () => {
    setSelectedIndex((validSelectedIndex + 1) % props.items.length);
  };

  const enterHandler = () => {
    selectItem(validSelectedIndex);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowUp') {
        upHandler();
        return true;
      }

      if (event.key === 'ArrowDown') {
        downHandler();
        return true;
      }

      if (event.key === 'Enter') {
        enterHandler();
        return true;
      }

      return false;
    },
  }));

  if (props.items.length === 0) {
    return null;
  }

  return (
    <div className="bg-popover text-popover-foreground rounded-md shadow-md border border-border overflow-hidden min-w-[180px] p-1">
      {props.items.map((item, index) => (
        <button
          key={index}
          className={`flex items-center gap-2 w-full px-2 py-1.5 text-sm text-left rounded-sm transition-colors ${
            index === selectedIndex
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-accent hover:text-accent-foreground'
          }`}
          onClick={() => selectItem(index)}
        >
          <span className="text-base leading-none w-5 text-center">{item.emoji}</span>
          <span className="font-medium truncate flex-1 opacity-90">{item.name}</span>
          <span className="ml-auto text-xs text-muted-foreground font-mono opacity-0 group-hover:opacity-100">
            {item.shortcodes[0]}
          </span>
        </button>
      ))}
    </div>
  );
});

EmojiList.displayName = 'EmojiList';


import { useState, useMemo } from 'react';
import { Smile, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { emojis, applySkinTone, SKIN_TONES, hasSkinTones } from './plugins/emojiData';
import { Editor } from '@tiptap/react';
import { useRecentEmojis } from '@/hooks/useRecentEmojis';

interface EmojiPickerProps {
  editor: Editor;
  className?: string;
}

export function EmojiPicker({ editor, className }: EmojiPickerProps) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const { recents, addRecent } = useRecentEmojis();
  
  // State for the skin tone popup (internal state)
  const [skinToneEmojiState, setSkinToneEmojiState] = useState<{ emoji: string, index: number } | null>(null);
  
  // Derive actual active skin tone emoji - only show if popover is open
  const activeSkinToneEmoji = open ? skinToneEmojiState : null;

  // Filter emojis based on search
  const filteredEmojis = useMemo(() => {
    if (!search) return emojis;
    const lower = search.toLowerCase();
    return emojis.filter(
      (item) =>
        item.name.toLowerCase().includes(lower) ||
        item.shortcodes.some((s) => s.includes(lower)) ||
        item.tags.some((t) => t.includes(lower))
    );
  }, [search]);
  
  // Reset skin tone state when popover closes via onOpenChange
  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setSkinToneEmojiState(null);
    }
  };

  const insertEmoji = (emoji: string) => {
    editor.chain().focus().insertContent(emoji).run();
    addRecent(emoji);
    setOpen(false);
    setSkinToneEmojiState(null);
  };

  const handleEmojiClick = (item: typeof emojis[0], index: number) => {
    // If it supports skin tones, open the popup
    if (hasSkinTones(item.emoji)) {
        // Toggle if same, otherwise set new
        if (activeSkinToneEmoji?.index === index) {
            setSkinToneEmojiState(null);
        } else {
            setSkinToneEmojiState({ emoji: item.emoji, index });
        }
    } else {
        // Direct insert
        insertEmoji(item.emoji);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Emoji"
          className={cn(
            'p-2 rounded-md transition-colors',
            'hover:bg-gray-100 dark:hover:bg-gray-800',
            className
          )}
        >
          <Smile size={18} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        {/* Header: Search Only */}
        <div className="p-2 border-b border-border sticky top-0 bg-popover z-10 shadow-sm">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search emojis..."
              className="pl-8 h-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        {/* Recent Emojis */}
        {!search && recents.length > 0 && (
            <div className="p-2 border-b border-border bg-muted">
                <div className="text-xs text-muted-foreground mb-1 px-1 font-medium">Recently Used</div>
                <div className="flex gap-1 overflow-x-auto custom-scrollbar pb-1">
                    {recents.map((emoji, i) => (
                        <button
                            key={i}
                            onClick={() => insertEmoji(emoji)}
                            className="hover:bg-accent hover:text-accent-foreground rounded-md w-8 h-8 flex-shrink-0 flex items-center justify-center text-lg transition-colors cursor-pointer"
                        >
                            {emoji}
                        </button>
                    ))}
                </div>
            </div>
        )}

        {/* Main Grid */}
        <div 
            className="h-72 w-full overflow-y-auto custom-scrollbar p-2 relative"
            style={{ contentVisibility: 'auto' }} // Performance optimization
        >
          {filteredEmojis.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              No emojis found
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {filteredEmojis.map((item, index) => {
                 const isActive = activeSkinToneEmoji?.index === index;
                 
                 return (
                    <div key={`${item.name}-${index}`} className="relative group">
                        <button
                            onClick={() => handleEmojiClick(item, index)}
                            className={cn(
                                "rounded-md w-full aspect-square flex items-center justify-center text-xl transition-colors cursor-pointer relative",
                                isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent hover:text-accent-foreground"
                            )}
                            title={item.name}
                        >
                            {item.emoji}
                            {/* Tiny indicator for skin tones */}
                            {hasSkinTones(item.emoji) && (
                                <span className="absolute bottom-0.5 right-0.5 w-1 h-1 bg-muted-foreground/50 rounded-full" />
                            )}
                        </button>

                        {/* Skin Tone Popup (Absolute positioned over the clicked emoji) */}
                        {isActive && (
                            <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 bg-popover border border-border rounded-lg shadow-lg p-1 flex gap-1 animate-in fade-in zoom-in-95 duration-100">
                                {SKIN_TONES.map((tone) => (
                                    <button
                                        key={tone.name}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            insertEmoji(applySkinTone(item.emoji, tone.value));
                                        }}
                                        className="w-8 h-8 hover:bg-muted rounded text-xl flex items-center justify-center transition-transform hover:scale-110"
                                        title={tone.name}
                                    >
                                        {applySkinTone(item.emoji, tone.value)}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                 );
              })}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="p-1 border-t border-border bg-muted/30 text-[10px] text-muted-foreground text-center">
            {filteredEmojis.length} emojis
        </div>
      </PopoverContent>
    </Popover>
  );
}

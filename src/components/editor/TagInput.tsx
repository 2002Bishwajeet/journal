import { useState, useRef, useEffect } from 'react';
import { X, Hash } from 'lucide-react';
import { useTags } from '@/hooks/useTags';
import type { DocumentMetadata } from '@/types';

interface TagInputProps {
  docId: string;
  metadata: DocumentMetadata;
}

export function TagInput({ docId, metadata }: TagInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { tags: allTags, addTag, removeTag } = useTags();

  const suggestions = inputValue.trim()
    ? allTags.filter(t =>
        t.includes(inputValue.toLowerCase().replace(/^#/, '')) &&
        !metadata.tags.includes(t)
      ).slice(0, 5)
    : [];

  const handleAdd = (tag: string) => {
    addTag(docId, tag, metadata);
    setInputValue('');
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = inputValue.trim().replace(/^#/, '');
      if (val) handleAdd(val);
    }
    if (e.key === 'Backspace' && !inputValue && metadata.tags.length > 0) {
      removeTag(docId, metadata.tags[metadata.tags.length - 1], metadata);
    }
    if (e.key === 'Escape') {
      setShowSuggestions(false);
      inputRef.current?.blur();
    }
  };

  useEffect(() => {
    const close = () => setShowSuggestions(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2" onClick={(e) => e.stopPropagation()}>
      {metadata.tags.map(tag => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-xs font-medium text-muted-foreground group"
        >
          <Hash className="h-3 w-3 text-muted-foreground/50" />
          {tag}
          <button
            onClick={() => removeTag(docId, tag, metadata)}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <div className="relative">
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setShowSuggestions(true);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowSuggestions(true)}
          placeholder={metadata.tags.length === 0 ? 'Add tags...' : '#'}
          className="bg-transparent text-xs outline-none placeholder:text-muted-foreground/50 w-24"
        />
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-40">
            {suggestions.map(s => (
              <button
                key={s}
                onClick={() => handleAdd(s)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors flex items-center gap-2"
              >
                <Hash className="h-3 w-3 text-muted-foreground" />
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

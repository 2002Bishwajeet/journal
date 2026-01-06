import { useState, useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import { Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWebLLM, type RewriteStyle } from '@/hooks';

const REWRITE_OPTIONS: { label: string; style: RewriteStyle; group: 'transform' | 'tone' | 'extract' }[] = [
  { label: 'Proofread', style: 'proofread', group: 'transform' },
  { label: 'Rewrite', style: 'rewrite', group: 'transform' },
  { label: 'Friendly', style: 'friendly', group: 'tone' },
  { label: 'Professional', style: 'professional', group: 'tone' },
  { label: 'Concise', style: 'concise', group: 'tone' },
  { label: 'Summary', style: 'summary', group: 'extract' },
  { label: 'Key Points', style: 'keypoints', group: 'extract' },
  { label: 'List', style: 'list', group: 'extract' },
  { label: 'Table', style: 'table', group: 'extract' },
];

interface AIMenuProps {
  editor: Editor;
}

export default function AIMenu({ editor }: AIMenuProps) {
  const { isReady, isLoading, loadingProgress, initialize, rewrite } = useWebLLM();
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedText, setSelectedText] = useState('');

  // Track editor selection
  useEffect(() => {
    if (!editor) return;

    const updateSelection = () => {
      const { selection, doc } = editor.state;
      const text = selection.empty ? '' : doc.textBetween(selection.from, selection.to, ' ');
      setSelectedText(text);
    };

    // Initial check
    updateSelection();

    // Listen for updates
    editor.on('selectionUpdate', updateSelection);
    editor.on('update', updateSelection);

    return () => {
      editor.off('selectionUpdate', updateSelection);
      editor.off('update', updateSelection);
    };
  }, [editor]);

  const handleRewrite = async (style: RewriteStyle) => {
    if (!selectedText.trim()) return;
    
    setIsProcessing(true);
    try {
      const result = await rewrite(selectedText, style);
      
      // Apply changes directly to editor
      if (!editor.isDestroyed) {
        editor.chain().focus().deleteSelection().insertContent(result).run();
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleInitialize = async () => {
    await initialize();
  };

  const transformOptions = REWRITE_OPTIONS.filter(o => o.group === 'transform');
  const toneOptions = REWRITE_OPTIONS.filter(o => o.group === 'tone');
  const extractOptions = REWRITE_OPTIONS.filter(o => o.group === 'extract');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          disabled={isProcessing}
          aria-label="AI Actions"
        >
          {isProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {!isReady ? (
          <>
            <DropdownMenuLabel>AI Writing</DropdownMenuLabel>
            <DropdownMenuItem 
              onClick={handleInitialize} 
              disabled={isLoading}
              textValue={isLoading ? "Loading AI..." : "Enable AI"}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading ({Math.round(loadingProgress * 100)}%)
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Enable AI
                </>
              )}
            </DropdownMenuItem>
          </>
        ) : (
          <>
            {/* Hint when no text selected */}
            {!selectedText.trim() && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground italic">
                Select text to use AI features
              </div>
            )}
            
            {/* Transform */}
            {transformOptions.map(option => (
              <DropdownMenuItem
                key={option.style}
                onClick={() => handleRewrite(option.style)}
                disabled={!selectedText.trim()}
              >
                {option.label}
              </DropdownMenuItem>
            ))}
            
            <DropdownMenuSeparator />
            
            {/* Tone */}
            <DropdownMenuLabel className="text-xs text-muted-foreground">Tone</DropdownMenuLabel>
            {toneOptions.map(option => (
              <DropdownMenuItem
                key={option.style}
                onClick={() => handleRewrite(option.style)}
                disabled={!selectedText.trim()}
              >
                {option.label}
              </DropdownMenuItem>
            ))}
            
            <DropdownMenuSeparator />
            
            {/* Extract */}
            <DropdownMenuLabel className="text-xs text-muted-foreground">Extract</DropdownMenuLabel>
            {extractOptions.map(option => (
              <DropdownMenuItem
                key={option.style}
                onClick={() => handleRewrite(option.style)}
                disabled={!selectedText.trim()}
              >
                {option.label}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

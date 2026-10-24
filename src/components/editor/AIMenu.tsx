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
import { toast } from 'sonner';
import { activeEditor } from '@/lib/agent/activeEditor';
import { aiRequests } from '@/lib/agent/aiRequests';
import { approveEdit } from '@/lib/agent/approveEdit';
import { rewriteProposal } from '@/lib/agent/rewriteEdit';

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
  const [open, setOpen] = useState(false);

  // The /rewrite slash command opens the menu for the selection, in the note the user is looking at.
  useEffect(
    () =>
      aiRequests.subscribe((request) => {
        if (request === 'rewrite' && activeEditor.get()?.editor === editor && !editor.state.selection.empty) setOpen(true);
      }),
    [editor]
  );

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
    
    const { from, to } = editor.state.selection;
    setIsProcessing(true);
    try {
      const result = await rewrite(selectedText, style);

      // Validate result - check if AI actually returned something useful
      if (!result || result.trim() === selectedText.trim()) {
        toast.error("AI couldn't transform the text. Try again or select different text.");
        return;
      }

      // The result shows in the note as a preview; the note changes when the user accepts it.
      if (!editor.isDestroyed) {
        const label = REWRITE_OPTIONS.find((o) => o.style === style)?.label ?? style;
        const edit = rewriteProposal(editor, { from, to, original: selectedText }, result, { asTable: style === 'table', label });
        void approveEdit({ edit });
      }
    } catch (error) {
      console.error('[AIMenu] Rewrite failed:', error);
      toast.error("AI processing failed. Please try again.");
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
    <DropdownMenu open={open} onOpenChange={setOpen}>
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

/**
 * AI Suggestion Overlay Component
 * 
 * Displays AI-generated content as an inline highlighted suggestion
 * that can be accepted or rejected. Provides a floating tooltip
 * with Accept/Reject buttons.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { Check, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWebLLM, useDeviceType } from '@/hooks';

interface AISuggestionOverlayProps {
  editor: Editor;
  /** Callback when AI action is triggered from slash commands */
  onAIAction?: (action: string) => void;
}

interface SuggestionState {
  isVisible: boolean;
  isLoading: boolean;
  originalText: string;
  suggestedText: string;
  position: { from: number; to: number } | null;
  action: string;
}

export function AISuggestionOverlay({ editor }: AISuggestionOverlayProps) {
  const { isReady, rewrite, chat, initialize, isLoading: isModelLoading } = useWebLLM();
  const deviceType = useDeviceType();
  
  if (deviceType === 'mobile') return null;

  const [suggestion, setSuggestion] = useState<SuggestionState>({
    isVisible: false,
    isLoading: false,
    originalText: '',
    suggestedText: '',
    position: null,
    action: '',
  });
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Calculate tooltip position based on editor selection/cursor
  const updateTooltipPosition = useCallback(() => {
    if (!editor || !suggestion.position) return;

    const view = editor.view;
    const coords = view.coordsAtPos(suggestion.position.to);
    
    setTooltipPos({
      top: coords.top - 44,
      left: coords.left,
    });
  }, [editor, suggestion.position]);

  // Update position when suggestion changes
  useEffect(() => {
    if (suggestion.isVisible && suggestion.position) {
      // Schedule position update outside React's render cycle
      requestAnimationFrame(() => {
        updateTooltipPosition();
      });
    }
  }, [suggestion.isVisible, suggestion.position, updateTooltipPosition]);

  // Listen for AI slash command events
  useEffect(() => {
    const handleAICommand = async (event: CustomEvent<{ action: string }>) => {
      const { action } = event.detail;
      
      // Get current selection or note content
      const { selection, doc } = editor.state;
      const selectedText = selection.empty 
        ? '' 
        : doc.textBetween(selection.from, selection.to, ' ');

      // If no text selected and it's a rewrite action, show message
      if (!selectedText && action === 'rewrite') {
        // Insert a message at cursor
        editor.chain().focus().insertContent({
          type: 'paragraph',
          content: [{ type: 'text', text: '⚠️ Please select some text first to use Rewrite.' }],
        }).run();
        return;
      }

      // Initialize AI if not ready
      if (!isReady && !isModelLoading) {
        await initialize();
      }

      setSuggestion({
        isVisible: true,
        isLoading: true,
        originalText: selectedText,
        suggestedText: '',
        position: selection.empty ? null : { from: selection.from, to: selection.to },
        action,
      });

      try {
        let result = '';

        switch (action) {
          case 'summarize': {
            // Get full note content
            const noteContent = editor.getText().slice(0, 3000);
            const messages = [
              { role: 'system' as const, content: 'You are a helpful assistant. Provide concise summaries.' },
              { role: 'user' as const, content: `Please summarize the following text:\n\n${noteContent}` },
            ];
            result = await chat(messages);
            // For summarize, we'll insert at cursor position
            setSuggestion(prev => ({
              ...prev,
              isLoading: false,
              suggestedText: result,
              position: { from: selection.from, to: selection.from }, // Insert at cursor
            }));
            break;
          }

          case 'ask': {
            // This should open the chat interface instead
            // For now, insert a prompt placeholder
            editor.chain().focus().insertContent({
              type: 'paragraph',
              content: [{ type: 'text', text: '💬 Use the chat button in the bottom right to ask AI questions!' }],
            }).run();
            setSuggestion(prev => ({ ...prev, isVisible: false, isLoading: false }));
            return;
          }

          case 'rewrite': {
            result = await rewrite(selectedText, 'rewrite');
            setSuggestion(prev => ({
              ...prev,
              isLoading: false,
              suggestedText: result,
            }));
            break;
          }

          default:
            setSuggestion(prev => ({ ...prev, isVisible: false, isLoading: false }));
            return;
        }
      } catch (error) {
        console.error('[AISuggestionOverlay] Error:', error);
        setSuggestion(prev => ({ ...prev, isVisible: false, isLoading: false }));
      }
    };

    window.addEventListener('ai-slash-command', handleAICommand as unknown as EventListener);
    return () => {
      window.removeEventListener('ai-slash-command', handleAICommand as unknown as EventListener);
    };
  }, [editor, isReady, isModelLoading, initialize, rewrite, chat]);

  // Accept the suggestion
  const handleAccept = useCallback(() => {
    if (!suggestion.suggestedText || !suggestion.position) return;

    const { from, to } = suggestion.position;

    // Create a named transaction for undo history
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .insertContentAt(from, suggestion.suggestedText)
      .run();

    // Reset suggestion state
    setSuggestion({
      isVisible: false,
      isLoading: false,
      originalText: '',
      suggestedText: '',
      position: null,
      action: '',
    });
  }, [editor, suggestion]);

  // Reject the suggestion
  const handleReject = useCallback(() => {
    setSuggestion({
      isVisible: false,
      isLoading: false,
      originalText: '',
      suggestedText: '',
      position: null,
      action: '',
    });
    editor.commands.focus();
  }, [editor]);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!suggestion.isVisible || suggestion.isLoading) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        handleAccept();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        handleReject();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [suggestion.isVisible, suggestion.isLoading, handleAccept, handleReject]);

  if (!suggestion.isVisible) return null;

  return (
    <>
      {/* Inline suggestion preview (shown as highlighted text) */}
      {suggestion.suggestedText && suggestion.position && (
        <div
          className="fixed z-40 pointer-events-none"
          style={{
            top: tooltipPos.top + 44,
            left: tooltipPos.left,
          }}
        >
          <div className="bg-green-500/10 border border-green-500/30 rounded px-2 py-1 max-w-md text-sm">
            <span className="text-green-700 dark:text-green-300 whitespace-pre-wrap line-clamp-3">
              {suggestion.suggestedText}
            </span>
          </div>
        </div>
      )}

      {/* Accept/Reject tooltip */}
      <div
        ref={tooltipRef}
        className={cn(
          'fixed z-50 flex items-center gap-1 px-2 py-1.5 rounded-lg shadow-lg border border-border bg-popover',
          'animate-in fade-in-0 zoom-in-95 duration-150'
        )}
        style={{
          top: `${tooltipPos.top}px`,
          left: `${tooltipPos.left}px`,
          transform: 'translateX(-50%)',
        }}
      >
        {suggestion.isLoading ? (
          <div className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Generating...</span>
          </div>
        ) : (
          <>
            <button
              onClick={handleAccept}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-sm font-medium bg-green-500/10 text-green-700 dark:text-green-400 hover:bg-green-500/20 transition-colors"
              title="Accept (⌘+Enter)"
            >
              <Check className="h-4 w-4" />
              <span>Accept</span>
            </button>
            <button
              onClick={handleReject}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-sm font-medium bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-500/20 transition-colors"
              title="Reject (Esc)"
            >
              <X className="h-4 w-4" />
              <span>Reject</span>
            </button>
            <div className="w-px h-5 bg-border mx-1" />
            <span className="text-xs text-muted-foreground">
              ⌘↵ / Esc
            </span>
          </>
        )}
      </div>
    </>
  );
}

export default AISuggestionOverlay;

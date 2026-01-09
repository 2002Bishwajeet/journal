/**
 * Drawing Toolbar Component
 * 
 * Apple Notes-style floating toolbar with:
 * - Pen mode selector with tool hints
 * - Color palette
 * - Size slider
 * - Shape tools
 * - Undo/Redo/Clear actions
 */

import { useCallback } from 'react';
import {
  Pen,
  Pencil,
  Highlighter,
  Type,
  Eraser,
  Square,
  Circle,
  Minus,
  ArrowRight,
  Undo2,
  Redo2,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DrawingTool, ShapeTool } from '@/hooks/useDrawingCanvas';
import { DEFAULT_COLORS } from '@/hooks/useDrawingCanvas';

interface DrawingToolbarProps {
  tool: DrawingTool;
  shapeTool: ShapeTool;
  color: string;
  size: number;
  canUndo: boolean;
  canRedo: boolean;
  isRecognizing: boolean;
  onToolChange: (tool: DrawingTool) => void;
  onShapeToolChange: (tool: ShapeTool) => void;
  onColorChange: (color: string) => void;
  onSizeChange: (size: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

// Tool definitions with hints (like Apple Notes)
const TOOLS: { id: DrawingTool; icon: typeof Pen; label: string; hint: string }[] = [
  { id: 'pen', icon: Pen, label: 'Pen', hint: 'Smooth ink strokes' },
  { id: 'pencil', icon: Pencil, label: 'Pencil', hint: 'Textured pencil marks' },
  { id: 'highlighter', icon: Highlighter, label: 'Highlighter', hint: 'Transparent highlight' },
  { id: 'scribble', icon: Type, label: 'Scribble', hint: 'Converts handwriting to text' },
  { id: 'eraser', icon: Eraser, label: 'Eraser', hint: 'Remove strokes' },
];

const SHAPES: { id: ShapeTool; icon: typeof Square; label: string }[] = [
  { id: 'rectangle', icon: Square, label: 'Rectangle' },
  { id: 'circle', icon: Circle, label: 'Circle' },
  { id: 'line', icon: Minus, label: 'Line' },
  { id: 'arrow', icon: ArrowRight, label: 'Arrow' },
];

export function DrawingToolbar({
  tool,
  shapeTool,
  color,
  size,
  canUndo,
  canRedo,
  isRecognizing,
  onToolChange,
  onShapeToolChange,
  onColorChange,
  onSizeChange,
  onUndo,
  onRedo,
  onClear,
}: DrawingToolbarProps) {
  const currentToolDef = TOOLS.find(t => t.id === tool);

  const handleShapeClick = useCallback((shapeId: ShapeTool) => {
    if (shapeTool === shapeId) {
      onShapeToolChange(null);
    } else {
      onShapeToolChange(shapeId);
    }
  }, [shapeTool, onShapeToolChange]);

  return (
    <div className="drawing-toolbar flex flex-col gap-2 p-3 bg-background/95 backdrop-blur-sm border border-border rounded-xl shadow-lg">
      {/* Tool Selector */}
      <div className="flex items-center gap-1">
        {TOOLS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => onToolChange(id)}
            className={cn(
              'tool-button flex items-center justify-center w-10 h-10 rounded-lg transition-all',
              'hover:bg-muted',
              tool === id && !shapeTool && 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
            title={label}
            aria-label={label}
          >
            <Icon size={18} />
          </button>
        ))}
      </div>

      {/* Tool Hint */}
      {currentToolDef && !shapeTool && (
        <div className={cn(
          'tool-hint text-xs px-2 py-1 rounded text-center',
          tool === 'scribble' 
            ? 'bg-primary/10 text-primary font-medium' 
            : 'bg-muted text-muted-foreground'
        )}>
          {isRecognizing ? (
            <span className="flex items-center justify-center gap-1">
              <span className="animate-spin w-3 h-3 border-2 border-primary border-t-transparent rounded-full" />
              Converting...
            </span>
          ) : (
            currentToolDef.hint
          )}
        </div>
      )}

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Color Palette */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {DEFAULT_COLORS.map(c => (
          <button
            key={c}
            onClick={() => onColorChange(c)}
            className={cn(
              'w-6 h-6 rounded-full border-2 transition-transform',
              color === c ? 'border-primary scale-110' : 'border-transparent hover:scale-105'
            )}
            style={{ backgroundColor: c }}
            title={c}
            aria-label={`Color ${c}`}
          />
        ))}
      </div>

      {/* Size Slider */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-8">Size</span>
        <input
          type="range"
          min="1"
          max="40"
          value={size}
          onChange={(e) => onSizeChange(parseInt(e.target.value, 10))}
          className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
        />
        <span className="text-xs text-muted-foreground w-6 text-right">{size}</span>
      </div>

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Shape Tools */}
      <div className="flex items-center gap-1">
        {SHAPES.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => handleShapeClick(id)}
            className={cn(
              'tool-button flex items-center justify-center w-9 h-9 rounded-lg transition-all',
              'hover:bg-muted',
              shapeTool === id && 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
            title={label}
            aria-label={label}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className={cn(
            'flex items-center justify-center w-9 h-9 rounded-lg transition-all',
            'hover:bg-muted',
            !canUndo && 'opacity-40 cursor-not-allowed'
          )}
          title="Undo"
          aria-label="Undo"
        >
          <Undo2 size={16} />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className={cn(
            'flex items-center justify-center w-9 h-9 rounded-lg transition-all',
            'hover:bg-muted',
            !canRedo && 'opacity-40 cursor-not-allowed'
          )}
          title="Redo"
          aria-label="Redo"
        >
          <Redo2 size={16} />
        </button>
        <div className="flex-1" />
        <button
          onClick={onClear}
          className="flex items-center justify-center w-9 h-9 rounded-lg transition-all hover:bg-destructive/10 hover:text-destructive"
          title="Clear All"
          aria-label="Clear All"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

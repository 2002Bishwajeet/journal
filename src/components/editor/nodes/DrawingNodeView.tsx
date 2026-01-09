/**
 * Drawing Node View Component
 * 
 * Renders an inline drawing canvas within the TipTap editor.
 * Features:
 * - SVG-based canvas for smooth strokes
 * - Apple Notes-style toolbar
 * - Pressure-sensitive drawing
 * - Shape tools
 * - Handwriting-to-text (OCR) with Scribble pen
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useDrawingCanvas } from '@/hooks/useDrawingCanvas';
import { DrawingToolbar } from '../shared/DrawingToolbar';
import {
  getStrokePath,
  getStrokeOpacity,
  getShapePath,
  deserializeDrawingData,
  serializeDrawingData,
  type Stroke,
  type Shape,
} from '@/lib/drawing/strokeUtils';
import { cn } from '@/lib/utils';

export function DrawingNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Derive toolbar visibility from props and state
  const showToolbar = selected || isEditing;

  // Parse initial data from node attributes
  const initialData = useMemo(() => {
    try {
      return deserializeDrawingData(node.attrs.data);
    } catch {
      return undefined;
    }
  }, [node.attrs.data]);

  const width = node.attrs.width as number;
  const height = node.attrs.height as number;

  // Handle data changes - update node attributes
  const handleDataChange = useCallback((data: Parameters<typeof serializeDrawingData>[0]) => {
    updateAttributes({ data: serializeDrawingData(data) });
  }, [updateAttributes]);

  // Handle recognized text from OCR
  const handleTextRecognized = useCallback((text: string) => {
    // Insert the recognized text after this drawing node
    // For now, just log it - could be enhanced to insert as text node
    console.log('[Drawing] Recognized text:', text);
    // The text could be inserted via editor commands if needed
  }, []);

  // Initialize drawing canvas hook
  const {
    strokes,
    shapes,
    currentStroke,
    currentShape,
    tool,
    shapeTool,
    color,
    size,
    canUndo,
    canRedo,
    isRecognizing,
    setTool,
    setShapeTool,
    setColor,
    setSize,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    undo,
    redo,
    clear,
    setDrawingData,
  } = useDrawingCanvas({
    initialData,
    width,
    height,
    onDataChange: handleDataChange,
    onTextRecognized: handleTextRecognized,
  });

  // Sync external data changes
  useEffect(() => {
    if (initialData) {
      setDrawingData(initialData);
    }
  }, [node.attrs.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle click to enter edit mode
  const handleCanvasClick = useCallback(() => {
    setIsEditing(true);
  }, []);

  // Handle click outside to exit edit mode
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsEditing(false);
      }
    };

    if (isEditing) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isEditing]);

  // Render a stroke as SVG path
  const renderStroke = useCallback((stroke: Stroke, isPreview = false) => {
    const path = getStrokePath(stroke);
    if (!path) return null;

    return (
      <path
        key={stroke.id}
        d={path}
        fill={stroke.color}
        opacity={getStrokeOpacity(stroke.tool)}
        style={{
          filter: stroke.tool === 'pencil' ? 'url(#pencilTexture)' : undefined,
        }}
        className={isPreview ? 'pointer-events-none' : undefined}
      />
    );
  }, []);

  // Render a shape as SVG path
  const renderShape = useCallback((shape: Shape, isPreview = false) => {
    const path = getShapePath(shape);
    if (!path) return null;

    const isFilled = shape.type === 'rectangle' || shape.type === 'circle';

    return (
      <path
        key={shape.id}
        d={path}
        fill={isFilled ? (shape.fill || 'transparent') : 'none'}
        stroke={shape.color}
        strokeWidth={shape.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={isPreview ? 'pointer-events-none' : undefined}
      />
    );
  }, []);

  return (
    <NodeViewWrapper className="drawing-node-wrapper my-4">
      <div
        ref={containerRef}
        className={cn(
          'drawing-canvas-wrapper relative inline-block rounded-xl border-2 transition-colors',
          selected ? 'border-primary' : 'border-border',
          isEditing ? 'ring-2 ring-primary/20' : ''
        )}
        style={{ width, maxWidth: '100%' }}
      >
        {/* Toolbar */}
        {showToolbar && (
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full z-10">
            <DrawingToolbar
              tool={tool}
              shapeTool={shapeTool}
              color={color}
              size={size}
              canUndo={canUndo}
              canRedo={canRedo}
              isRecognizing={isRecognizing}
              onToolChange={setTool}
              onShapeToolChange={setShapeTool}
              onColorChange={setColor}
              onSizeChange={setSize}
              onUndo={undo}
              onRedo={redo}
              onClear={clear}
            />
          </div>
        )}

        {/* Canvas */}
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className={cn(
            'drawing-canvas block rounded-xl bg-background',
            isEditing ? 'cursor-crosshair' : 'cursor-pointer'
          )}
          style={{
            touchAction: 'none',
            maxWidth: '100%',
            height: 'auto',
          }}
          onClick={!isEditing ? handleCanvasClick : undefined}
          onPointerDown={isEditing ? handlePointerDown : undefined}
          onPointerMove={isEditing ? handlePointerMove : undefined}
          onPointerUp={isEditing ? handlePointerUp : undefined}
          onPointerLeave={isEditing ? handlePointerUp : undefined}
        >
          {/* Filters */}
          <defs>
            {/* Pencil texture filter */}
            <filter id="pencilTexture" x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves="3" result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="1" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>

          {/* Background grid (optional, subtle) */}
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path
                d="M 20 0 L 0 0 0 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.5"
                opacity="0.1"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* Shapes */}
          {shapes.map(shape => renderShape(shape))}
          
          {/* Current shape preview */}
          {currentShape && renderShape(currentShape, true)}

          {/* Strokes */}
          {strokes.map(stroke => renderStroke(stroke))}
          
          {/* Current stroke preview */}
          {currentStroke && renderStroke(currentStroke, true)}
        </svg>

        {/* Empty state hint */}
        {strokes.length === 0 && shapes.length === 0 && !isEditing && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-sm text-muted-foreground/50">
              Click to draw
            </span>
          </div>
        )}

        {/* OCR processing indicator */}
        {isRecognizing && (
          <div className="absolute bottom-2 right-2 flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground text-xs rounded-full">
            <span className="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
            Converting...
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

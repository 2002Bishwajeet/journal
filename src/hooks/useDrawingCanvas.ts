/**
 * useDrawingCanvas Hook
 * 
 * Manages drawing canvas state including:
 * - Tool selection (pen, pencil, highlighter, scribble, eraser)
 * - Stroke collection and rendering
 * - Shape drawing
 * - Undo/redo history
 * - Pointer event handling with pressure support
 */

import { useState, useCallback, useRef } from 'react';
import {
    type Stroke,
    type Shape,
    type Point,
    type DrawingData,
    generateId,
    checkStrokeIntersection,
} from '@/lib/drawing/strokeUtils';
import { recognizeStrokesAsText } from '@/lib/drawing/ocrService';

export type DrawingTool = 'pen' | 'pencil' | 'highlighter' | 'scribble' | 'eraser' | 'select';
export type ShapeTool = 'rectangle' | 'circle' | 'line' | 'arrow' | null;

interface UseDrawingCanvasOptions {
    initialData?: DrawingData;
    width?: number;
    height?: number;
    onDataChange?: (data: DrawingData) => void;
    onTextRecognized?: (text: string) => void;
}

interface UseDrawingCanvasReturn {
    // Data
    strokes: Stroke[];
    shapes: Shape[];
    currentStroke: Stroke | null;
    currentShape: Shape | null;

    // Tool state
    tool: DrawingTool;
    shapeTool: ShapeTool;
    color: string;
    size: number;

    // Actions
    setTool: (tool: DrawingTool) => void;
    setShapeTool: (tool: ShapeTool) => void;
    setColor: (color: string) => void;
    setSize: (size: number) => void;

    // Drawing handlers
    handlePointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
    handlePointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
    handlePointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;

    // History
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    clear: () => void;

    // OCR state
    isRecognizing: boolean;

    // Export
    getDrawingData: () => DrawingData;
    setDrawingData: (data: DrawingData) => void;
}

// Default colors palette (Apple Notes inspired)
export const DEFAULT_COLORS = [
    '#000000', // Black
    '#FF3B30', // Red
    '#FF9500', // Orange
    '#FFCC00', // Yellow
    '#34C759', // Green
    '#007AFF', // Blue
    '#5856D6', // Purple
    '#AF52DE', // Magenta
];

// Default sizes
export const DEFAULT_SIZES = {
    pen: 4,
    pencil: 2,
    highlighter: 20,
    scribble: 4,
    eraser: 20,
    select: 0,
};

export function useDrawingCanvas(options: UseDrawingCanvasOptions = {}): UseDrawingCanvasReturn {
    const {
        initialData,
        width = 600,
        height = 400,
        onDataChange,
        onTextRecognized,
    } = options;

    // State
    const [strokes, setStrokes] = useState<Stroke[]>(initialData?.strokes ?? []);
    const [shapes, setShapes] = useState<Shape[]>(initialData?.shapes ?? []);
    const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);
    const [currentShape, setCurrentShape] = useState<Shape | null>(null);

    const [tool, setToolState] = useState<DrawingTool>('pen');
    const [shapeTool, setShapeToolState] = useState<ShapeTool>(null);
    const [color, setColor] = useState('#000000');
    const [size, setSize] = useState(DEFAULT_SIZES.pen);

    const [isRecognizing, setIsRecognizing] = useState(false);

    // History for undo/redo
    const historyRef = useRef<{ strokes: Stroke[]; shapes: Shape[] }[]>([]);
    const historyIndexRef = useRef(-1);
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    // Drawing state
    const isDrawingRef = useRef(false);
    const scribbleStrokesRef = useRef<Stroke[]>([]);

    // Save state to history
    const saveToHistory = useCallback(() => {
        // Remove any future history if we've undone
        historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);

        // Add current state
        historyRef.current.push({ strokes: [...strokes], shapes: [...shapes] });
        historyIndexRef.current = historyRef.current.length - 1;

        // Limit history size
        if (historyRef.current.length > 50) {
            historyRef.current.shift();
            historyIndexRef.current--;
        }

        setCanUndo(historyIndexRef.current > 0);
        setCanRedo(false);
    }, [strokes, shapes]);

    // Notify parent of data changes
    const notifyChange = useCallback((newStrokes: Stroke[], newShapes: Shape[]) => {
        if (onDataChange) {
            onDataChange({
                strokes: newStrokes,
                shapes: newShapes,
                width,
                height,
                backgroundColor: initialData?.backgroundColor ?? 'transparent',
            });
        }
    }, [onDataChange, width, height, initialData?.backgroundColor]);

    // Tool setters
    const setTool = useCallback((newTool: DrawingTool) => {
        setToolState(newTool);
        setShapeToolState(null);
        setSize(DEFAULT_SIZES[newTool]);
    }, []);

    const setShapeTool = useCallback((newShapeTool: ShapeTool) => {
        setShapeToolState(newShapeTool);
        if (newShapeTool) {
            setToolState('select');
        }
    }, []);

    // Get point from pointer event
    const getPoint = useCallback((e: React.PointerEvent<SVGSVGElement>): Point => {
        const svg = e.currentTarget;
        const rect = svg.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        // Use pressure from Apple Pencil, default to 0.5 for mouse
        const pressure = e.pressure > 0 ? e.pressure : 0.5;
        return { x, y, pressure };
    }, []);

    // Pointer down handler
    const handlePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
        // Only handle primary pointer (ignore multi-touch for now)
        if (!e.isPrimary) return;

        // Capture pointer for smooth tracking
        e.currentTarget.setPointerCapture(e.pointerId);

        isDrawingRef.current = true;
        const point = getPoint(e);

        if (shapeTool) {
            // Start shape drawing
            const newShape: Shape = {
                id: generateId(),
                type: shapeTool,
                startPoint: { x: point.x, y: point.y },
                endPoint: { x: point.x, y: point.y },
                color,
                strokeWidth: size,
            };
            setCurrentShape(newShape);
        } else if (tool === 'eraser') {
            // Eraser mode - check for intersections
            const eraserRadius = size;
            setStrokes(prev => {
                const newStrokes = prev.filter(stroke =>
                    !checkStrokeIntersection(stroke.points, point, eraserRadius)
                );
                if (newStrokes.length !== prev.length) {
                    notifyChange(newStrokes, shapes);
                }
                return newStrokes;
            });
        } else if (tool !== 'select') {
            // Start new stroke
            const newStroke: Stroke = {
                id: generateId(),
                points: [point],
                tool: tool as Stroke['tool'],
                color,
                size,
                timestamp: Date.now(),
            };
            setCurrentStroke(newStroke);

            // Track scribble strokes for OCR
            if (tool === 'scribble') {
                scribbleStrokesRef.current = [];
            }
        }
    }, [tool, shapeTool, color, size, getPoint, shapes, notifyChange]);

    // Pointer move handler
    const handlePointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
        if (!isDrawingRef.current || !e.isPrimary) return;

        const point = getPoint(e);

        if (currentShape && shapeTool) {
            // Update shape endpoint
            setCurrentShape(prev => prev ? {
                ...prev,
                endPoint: { x: point.x, y: point.y },
            } : null);
        } else if (tool === 'eraser') {
            // Continue erasing
            const eraserRadius = size;
            setStrokes(prev => {
                const newStrokes = prev.filter(stroke =>
                    !checkStrokeIntersection(stroke.points, point, eraserRadius)
                );
                if (newStrokes.length !== prev.length) {
                    notifyChange(newStrokes, shapes);
                }
                return newStrokes;
            });
        } else if (currentStroke) {
            // Add point to current stroke
            setCurrentStroke(prev => prev ? {
                ...prev,
                points: [...prev.points, point],
            } : null);
        }
    }, [tool, shapeTool, currentShape, currentStroke, size, getPoint, shapes, notifyChange]);

    // Pointer up handler
    const handlePointerUp = useCallback(async (e: React.PointerEvent<SVGSVGElement>) => {
        if (!e.isPrimary) return;

        e.currentTarget.releasePointerCapture(e.pointerId);
        isDrawingRef.current = false;

        if (currentShape && shapeTool) {
            // Finalize shape
            saveToHistory();
            setShapes(prev => {
                const newShapes = [...prev, currentShape];
                notifyChange(strokes, newShapes);
                return newShapes;
            });
            setCurrentShape(null);
        } else if (currentStroke) {
            // Finalize stroke
            saveToHistory();

            const finalStroke = currentStroke;
            setStrokes(prev => {
                const newStrokes = [...prev, finalStroke];
                notifyChange(newStrokes, shapes);
                return newStrokes;
            });
            setCurrentStroke(null);

            // Handle scribble OCR
            if (tool === 'scribble' && finalStroke.points.length > 5) {
                scribbleStrokesRef.current.push(finalStroke);

                // Run OCR after a short delay (to batch multiple quick strokes)
                setIsRecognizing(true);
                try {
                    const text = await recognizeStrokesAsText(
                        scribbleStrokesRef.current,
                        width,
                        height
                    );

                    if (text && onTextRecognized) {
                        onTextRecognized(text);

                        // Clear the scribble strokes after successful recognition
                        setStrokes(prev => {
                            const scribbleIds = new Set(scribbleStrokesRef.current.map(s => s.id));
                            return prev.filter(s => !scribbleIds.has(s.id));
                        });
                        scribbleStrokesRef.current = [];
                    }
                } catch (error) {
                    console.error('OCR failed:', error);
                } finally {
                    setIsRecognizing(false);
                }
            }
        }
    }, [currentShape, currentStroke, shapeTool, tool, saveToHistory, strokes, shapes, notifyChange, width, height, onTextRecognized]);

    // Undo
    const undo = useCallback(() => {
        if (historyIndexRef.current > 0) {
            historyIndexRef.current--;
            const state = historyRef.current[historyIndexRef.current];
            setStrokes(state.strokes);
            setShapes(state.shapes);
            notifyChange(state.strokes, state.shapes);
            setCanUndo(historyIndexRef.current > 0);
            setCanRedo(true);
        }
    }, [notifyChange]);

    // Redo
    const redo = useCallback(() => {
        if (historyIndexRef.current < historyRef.current.length - 1) {
            historyIndexRef.current++;
            const state = historyRef.current[historyIndexRef.current];
            setStrokes(state.strokes);
            setShapes(state.shapes);
            notifyChange(state.strokes, state.shapes);
            setCanUndo(true);
            setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
        }
    }, [notifyChange]);

    // Clear all
    const clear = useCallback(() => {
        saveToHistory();
        setStrokes([]);
        setShapes([]);
        notifyChange([], []);
    }, [saveToHistory, notifyChange]);

    // Get current drawing data
    const getDrawingData = useCallback((): DrawingData => ({
        strokes,
        shapes,
        width,
        height,
        backgroundColor: initialData?.backgroundColor ?? 'transparent',
    }), [strokes, shapes, width, height, initialData?.backgroundColor]);

    // Set drawing data
    const setDrawingData = useCallback((data: DrawingData) => {
        setStrokes(data.strokes);
        setShapes(data.shapes);
        historyRef.current = [{ strokes: data.strokes, shapes: data.shapes }];
        historyIndexRef.current = 0;
        setCanUndo(false);
        setCanRedo(false);
    }, []);

    return {
        strokes,
        shapes,
        currentStroke,
        currentShape,
        tool,
        shapeTool,
        color,
        size,
        setTool,
        setShapeTool,
        setColor,
        setSize,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
        undo,
        redo,
        canUndo,
        canRedo,
        clear,
        isRecognizing,
        getDrawingData,
        setDrawingData,
    };
}

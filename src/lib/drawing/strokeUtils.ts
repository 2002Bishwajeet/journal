/**
 * Stroke Utilities for Drawing Canvas
 * 
 * Uses perfect-freehand for pressure-sensitive stroke rendering.
 * Provides tools for different pen types and shape drawing.
 */

import getStroke from 'perfect-freehand';

// Types
export interface Point {
    x: number;
    y: number;
    pressure: number;
}

export interface Stroke {
    id: string;
    points: Point[];
    tool: 'pen' | 'pencil' | 'highlighter' | 'scribble';
    color: string;
    size: number;
    timestamp: number;
}

export interface Shape {
    id: string;
    type: 'rectangle' | 'circle' | 'line' | 'arrow';
    startPoint: { x: number; y: number };
    endPoint: { x: number; y: number };
    color: string;
    strokeWidth: number;
    fill?: string;
}

export interface DrawingData {
    strokes: Stroke[];
    shapes: Shape[];
    width: number;
    height: number;
    backgroundColor: string;
}

// Tool configurations for perfect-freehand
const toolOptions = {
    pen: {
        size: 8,
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0.5,
        simulatePressure: true,
    },
    pencil: {
        size: 4,
        thinning: 0.6,
        smoothing: 0.4,
        streamline: 0.3,
        simulatePressure: true,
    },
    highlighter: {
        size: 24,
        thinning: 0,
        smoothing: 0.5,
        streamline: 0.5,
        simulatePressure: false,
    },
    scribble: {
        size: 6,
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0.5,
        simulatePressure: true,
    },
};

/**
 * Convert stroke points to SVG path using perfect-freehand
 */
export function getStrokePath(stroke: Stroke): string {
    if (stroke.points.length < 2) return '';

    const options = {
        ...toolOptions[stroke.tool],
        size: stroke.size,
    };

    const points = stroke.points.map(p => [p.x, p.y, p.pressure] as [number, number, number]);
    const outlinePoints = getStroke(points, options);

    if (outlinePoints.length < 2) return '';

    return getSvgPathFromStroke(outlinePoints);
}

/**
 * Convert perfect-freehand output to SVG path data
 */
function getSvgPathFromStroke(points: number[][]): string {
    if (points.length < 2) return '';

    const d = points.reduce(
        (acc, [x0, y0], i, arr) => {
            const [x1, y1] = arr[(i + 1) % arr.length];
            acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
            return acc;
        },
        ['M', ...points[0], 'Q']
    );

    d.push('Z');
    return d.join(' ');
}

/**
 * Get stroke opacity for highlighter effect
 */
export function getStrokeOpacity(tool: Stroke['tool']): number {
    return tool === 'highlighter' ? 0.4 : 1;
}

/**
 * Check if a point intersects with a stroke (for eraser)
 */
export function checkStrokeIntersection(
    strokePoints: Point[],
    eraserPoint: { x: number; y: number },
    eraserRadius: number
): boolean {
    return strokePoints.some(p => {
        const dx = p.x - eraserPoint.x;
        const dy = p.y - eraserPoint.y;
        return Math.sqrt(dx * dx + dy * dy) < eraserRadius;
    });
}

/**
 * Generate SVG path for shapes
 */
export function getShapePath(shape: Shape): string {
    const { startPoint, endPoint, type } = shape;

    switch (type) {
        case 'rectangle': {
            const x = Math.min(startPoint.x, endPoint.x);
            const y = Math.min(startPoint.y, endPoint.y);
            const width = Math.abs(endPoint.x - startPoint.x);
            const height = Math.abs(endPoint.y - startPoint.y);
            return `M ${x} ${y} L ${x + width} ${y} L ${x + width} ${y + height} L ${x} ${y + height} Z`;
        }
        case 'circle': {
            const cx = (startPoint.x + endPoint.x) / 2;
            const cy = (startPoint.y + endPoint.y) / 2;
            const rx = Math.abs(endPoint.x - startPoint.x) / 2;
            const ry = Math.abs(endPoint.y - startPoint.y) / 2;
            // SVG ellipse as path
            return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
        }
        case 'line':
            return `M ${startPoint.x} ${startPoint.y} L ${endPoint.x} ${endPoint.y}`;
        case 'arrow': {
            const dx = endPoint.x - startPoint.x;
            const dy = endPoint.y - startPoint.y;
            const angle = Math.atan2(dy, dx);
            const arrowLength = 12;
            const arrowAngle = Math.PI / 6;

            const x1 = endPoint.x - arrowLength * Math.cos(angle - arrowAngle);
            const y1 = endPoint.y - arrowLength * Math.sin(angle - arrowAngle);
            const x2 = endPoint.x - arrowLength * Math.cos(angle + arrowAngle);
            const y2 = endPoint.y - arrowLength * Math.sin(angle + arrowAngle);

            return `M ${startPoint.x} ${startPoint.y} L ${endPoint.x} ${endPoint.y} M ${x1} ${y1} L ${endPoint.x} ${endPoint.y} L ${x2} ${y2}`;
        }
        default:
            return '';
    }
}

/**
 * Create empty drawing data
 */
export function createEmptyDrawingData(width = 600, height = 400): DrawingData {
    return {
        strokes: [],
        shapes: [],
        width,
        height,
        backgroundColor: 'transparent',
    };
}

/**
 * Serialize drawing data for storage
 */
export function serializeDrawingData(data: DrawingData): string {
    return JSON.stringify(data);
}

/**
 * Deserialize drawing data from storage
 */
export function deserializeDrawingData(json: string): DrawingData {
    try {
        return JSON.parse(json) as DrawingData;
    } catch {
        return createEmptyDrawingData();
    }
}

/**
 * Generate unique ID for strokes/shapes
 */
export function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get bounding box of points (for OCR region extraction)
 */
export function getPointsBoundingBox(points: Point[]): {
    x: number;
    y: number;
    width: number;
    height: number;
} {
    if (points.length === 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }

    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
    };
}

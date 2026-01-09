/**
 * OCR Service for Handwriting-to-Text conversion
 * 
 * Uses tesseract.js for client-side OCR.
 * Lazy-loaded only when Scribble pen is used to save bundle size.
 * Worker files are cached by the service worker for offline support.
 */

import type { Stroke, Point } from './strokeUtils';
import type { Worker as TesseractWorker } from 'tesseract.js';

// Tesseract worker (lazy-loaded)
let workerInstance: TesseractWorker | null = null;
let workerPromise: Promise<TesseractWorker> | null = null;

/**
 * Initialize tesseract worker (lazy-loaded)
 */
async function getWorker(): Promise<TesseractWorker> {
    if (workerInstance) return workerInstance;
    if (workerPromise) return workerPromise;

    workerPromise = (async () => {
        const { createWorker } = await import('tesseract.js');

        // Create worker with options for offline support
        // tesseract.js caches trained data in IndexedDB
        const worker = await createWorker('eng', 1, {
            // Logger for debugging
            logger: (m: unknown) => {
                if (import.meta.env.DEV) {
                    console.log('[OCR]', m);
                }
            },
        });

        workerInstance = worker;
        return worker;
    })();

    return workerPromise;
}

/**
 * Convert canvas region to ImageData for OCR
 */
export function canvasToImageData(
    canvas: HTMLCanvasElement,
    region?: { x: number; y: number; width: number; height: number }
): ImageData {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('Could not get canvas context');
    }

    if (region) {
        return ctx.getImageData(region.x, region.y, region.width, region.height);
    }

    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Recognize handwriting from canvas image data
 * 
 * @param imageData - Canvas image data to recognize
 * @returns Recognized text
 */
export async function recognizeHandwriting(imageData: ImageData | HTMLCanvasElement): Promise<string> {
    try {
        const worker = await getWorker();

        // Convert ImageData to canvas if needed
        let source: HTMLCanvasElement;
        if (imageData instanceof ImageData) {
            source = document.createElement('canvas');
            source.width = imageData.width;
            source.height = imageData.height;
            const ctx = source.getContext('2d');
            if (!ctx) throw new Error('Could not get canvas context');
            ctx.putImageData(imageData, 0, 0);
        } else {
            source = imageData;
        }

        const { data } = await worker.recognize(source);
        return data.text.trim();
    } catch (error) {
        console.error('[OCR] Recognition failed:', error);
        throw error;
    }
}

/**
 * Recognize handwriting from strokes
 * Creates a temporary canvas with the strokes and runs OCR
 */
export async function recognizeStrokesAsText(
    strokes: Stroke[],
    canvasWidth: number,
    canvasHeight: number
): Promise<string> {
    if (strokes.length === 0) return '';

    // Create temporary canvas
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');

    // White background for better OCR
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Draw strokes in black for contrast
    ctx.strokeStyle = 'black';
    ctx.fillStyle = 'black';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const stroke of strokes) {
        if (stroke.points.length < 2) continue;

        ctx.lineWidth = stroke.size;
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

        for (let i = 1; i < stroke.points.length; i++) {
            const point = stroke.points[i];
            ctx.lineTo(point.x, point.y);
        }

        ctx.stroke();
    }

    return recognizeHandwriting(canvas);
}

/**
 * Calculate bounding box for strokes (to crop canvas for OCR)
 */
export function getStrokesBoundingBox(strokes: Stroke[]): {
    x: number;
    y: number;
    width: number;
    height: number;
} {
    if (strokes.length === 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }

    const allPoints: Point[] = strokes.flatMap(s => s.points);
    if (allPoints.length === 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }

    const xs = allPoints.map(p => p.x);
    const ys = allPoints.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // Add padding
    const padding = 20;
    return {
        x: Math.max(0, minX - padding),
        y: Math.max(0, minY - padding),
        width: maxX - minX + padding * 2,
        height: maxY - minY + padding * 2,
    };
}

/**
 * Cleanup tesseract worker
 */
export async function terminateWorker(): Promise<void> {
    if (workerInstance) {
        await workerInstance.terminate();
        workerInstance = null;
        workerPromise = null;
    }
}

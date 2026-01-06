/**
 * Memory monitoring utility for development
 * Logs memory usage periodically to help track memory leaks
 */

interface MemoryInfo {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
    memory?: MemoryInfo;
}

let monitorInterval: ReturnType<typeof setInterval> | null = null;
let lastMemory = 0;

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Start monitoring memory usage (dev mode only)
 * @param intervalMs - How often to log memory (default: 10 seconds)
 */
export function startMemoryMonitor(intervalMs: number = 10000): void {
    if (monitorInterval) return;

    const perf = performance as PerformanceWithMemory;

    if (!perf.memory) {
        console.warn('[MemoryMonitor] performance.memory not available (Chrome only)');
        return;
    }

    console.log('[MemoryMonitor] Started monitoring memory usage');

    monitorInterval = setInterval(() => {
        if (!perf.memory) return;

        const { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit } = perf.memory;
        const delta = usedJSHeapSize - lastMemory;
        const deltaStr = delta >= 0 ? `+${formatBytes(delta)}` : `-${formatBytes(Math.abs(delta))}`;

        console.log(
            `[Memory] Used: ${formatBytes(usedJSHeapSize)} (${deltaStr}) | ` +
            `Total: ${formatBytes(totalJSHeapSize)} | ` +
            `Limit: ${formatBytes(jsHeapSizeLimit)}`
        );

        // Warn if memory is getting high
        if (usedJSHeapSize > 500 * 1024 * 1024) { // > 500MB
            console.warn('[Memory] ⚠️ High memory usage detected!');
        }

        lastMemory = usedJSHeapSize;
    }, intervalMs);
}

/**
 * Stop monitoring memory usage
 */
export function stopMemoryMonitor(): void {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
        console.log('[MemoryMonitor] Stopped monitoring');
    }
}

/**
 * Take a memory snapshot and log it
 */
export function logMemorySnapshot(): void {
    const perf = performance as PerformanceWithMemory;

    if (!perf.memory) {
        console.warn('[MemoryMonitor] performance.memory not available');
        return;
    }

    const { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit } = perf.memory;

    console.log('=== Memory Snapshot ===');
    console.log(`  Used Heap:  ${formatBytes(usedJSHeapSize)}`);
    console.log(`  Total Heap: ${formatBytes(totalJSHeapSize)}`);
    console.log(`  Heap Limit: ${formatBytes(jsHeapSizeLimit)}`);
    console.log('=======================');
}

// Auto-start in development mode
if (import.meta.env.DEV) {
    // Expose to window for manual debugging
    (window as unknown as Record<string, unknown>).memoryMonitor = {
        start: startMemoryMonitor,
        stop: stopMemoryMonitor,
        snapshot: logMemorySnapshot,
    };

    console.log('[MemoryMonitor] Available via window.memoryMonitor.start(), .stop(), .snapshot()');
}

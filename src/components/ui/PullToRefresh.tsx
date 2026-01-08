import { useState, useRef, useCallback, type ReactNode } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: ReactNode;
  className?: string;
}

const PULL_THRESHOLD = 80;
const MAX_PULL = 120;
const FRICTION = 0.5;

export function PullToRefresh({ onRefresh, children, className }: PullToRefreshProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number>(0);
  const touchCurrentY = useRef<number>(0);
  const isPulling = useRef<boolean>(false);
  
  const y = useMotionValue(0);

  // Transform y value to opacity/rotation for indicators
  const opacity = useTransform(y, [0, PULL_THRESHOLD], [0, 1]);
  const rotate = useTransform(y, [0, MAX_PULL], [0, 360]);

  const getScrollableParent = useCallback((): HTMLElement | null => {
    if (!containerRef.current) return null;

    // Look for Radix ScrollArea viewport
    const scrollAreaViewport = containerRef.current.closest('[data-radix-scroll-area-viewport]');
    if (scrollAreaViewport) {
      return scrollAreaViewport as HTMLElement;
    }

    // Fallback: find nearest scrollable parent
    let parent = containerRef.current.parentElement;
    while (parent) {
      const style = window.getComputedStyle(parent);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        return parent;
      }
      parent = parent.parentElement;
    }

    return null;
  }, []);

  const isAtTop = useCallback((): boolean => {
    const scrollable = getScrollableParent();
    if (!scrollable) return true;
    return scrollable.scrollTop <= 0;
  }, [getScrollableParent]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isRefreshing) return;
    
    // Only start tracking if we're at the top
    if (isAtTop()) {
      touchStartY.current = e.touches[0].clientY;
      touchCurrentY.current = e.touches[0].clientY;
      isPulling.current = false;
    }
  }, [isAtTop, isRefreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (isRefreshing) return;
    if (touchStartY.current === 0) return;

    touchCurrentY.current = e.touches[0].clientY;
    const deltaY = touchCurrentY.current - touchStartY.current;

    // Only start pulling if dragging down significantly and at top
    if (deltaY > 10 && isAtTop()) {
      isPulling.current = true;
    }

    if (isPulling.current && deltaY > 0) {
      // Prevent native scroll while pulling
      e.preventDefault();
      
      // Apply friction
      const pullDistance = deltaY * FRICTION;
      const clampedDistance = Math.min(pullDistance, MAX_PULL);
      y.set(clampedDistance);
    }
  }, [isAtTop, isRefreshing, y]);

  const handleTouchEnd = useCallback(async () => {
    if (isRefreshing) return;
    
    const pullDistance = y.get();
    
    if (pullDistance >= PULL_THRESHOLD) {
      setIsRefreshing(true);
      animate(y, PULL_THRESHOLD, { duration: 0.2 });
      
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        animate(y, 0, { duration: 0.2 });
      }
    } else {
      animate(y, 0, { duration: 0.2 });
    }

    // Reset touch tracking
    touchStartY.current = 0;
    touchCurrentY.current = 0;
    isPulling.current = false;
  }, [isRefreshing, onRefresh, y]);

  return (
    <div 
      ref={containerRef} 
      className={cn("relative h-full flex flex-col", className)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ touchAction: 'pan-y' }}
    >
      {/* Loading Indicator Layer */}
      <motion.div
        className="absolute top-0 left-0 w-full flex items-center justify-center pointer-events-none z-10"
        style={{ 
          y: useTransform(y, (val) => val - 40), // Start hidden above
          opacity: isRefreshing ? 1 : opacity 
        }}
      >
        <div className="h-10 flex items-center justify-center p-2 rounded-full bg-background border shadow-sm">
          {isRefreshing ? (
             <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : (
             <motion.div style={{ rotate }}>
               <Loader2 className="h-5 w-5 text-muted-foreground" />
             </motion.div>
          )}
        </div>
      </motion.div>

      <motion.div
        className="flex-1 h-full"
        style={{ y }}
      >
        {children}
      </motion.div>
    </div>
  );
}

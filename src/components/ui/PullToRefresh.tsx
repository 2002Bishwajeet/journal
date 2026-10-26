import { useState, useRef, useEffect, type ReactNode } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { swipeAxis } from '@/helpers/swipeAxis';
import { haptic } from '@/lib/haptics';

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
  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);
  const touchCurrentY = useRef<number>(0);
  const isPulling = useRef<boolean>(false);

  const y = useMotionValue(0);

  // Transform y value to opacity/rotation for indicators
  const opacity = useTransform(y, [0, PULL_THRESHOLD], [0, 1]);
  const rotate = useTransform(y, [0, MAX_PULL], [0, 360]);

  const getScrollableParent = (): HTMLElement | null => {
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
  };

  const isAtTop = (): boolean => {
    const scrollable = getScrollableParent();
    if (!scrollable) return true;
    return scrollable.scrollTop <= 0;
  };

  // Native listeners: React registers touch handlers as passive, where
  // preventDefault() does nothing. touchmove must be non-passive to stop the
  // list from scrolling (and bouncing on iOS) while the custom pull runs.
  // The viewport's own bounce is switched off in index.css.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (isRefreshing) return;

      // Only start tracking if we're at the top
      if (isAtTop()) {
        touchStartX.current = e.touches[0].clientX;
        touchStartY.current = e.touches[0].clientY;
        touchCurrentY.current = e.touches[0].clientY;
        isPulling.current = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isRefreshing) return;
      if (touchStartY.current === 0) return;

      touchCurrentY.current = e.touches[0].clientY;
      const deltaY = touchCurrentY.current - touchStartY.current;
      const deltaX = e.touches[0].clientX - touchStartX.current;

      // Only start pulling on a mostly vertical drag down, at the top
      if (!isPulling.current && deltaY > 0 && swipeAxis(deltaX, deltaY) === 'y' && isAtTop()) {
        isPulling.current = true;
      }

      if (isPulling.current && deltaY > 0) {
        // Prevent native scroll while pulling
        if (e.cancelable) e.preventDefault();

        // Apply friction
        const pullDistance = deltaY * FRICTION;
        const clampedDistance = Math.min(pullDistance, MAX_PULL);
        y.set(clampedDistance);
      }
    };

    const handleTouchEnd = async () => {
      if (isRefreshing) return;

      const pullDistance = y.get();

      // Reset touch tracking
      touchStartX.current = 0;
      touchStartY.current = 0;
      touchCurrentY.current = 0;
      isPulling.current = false;

      if (pullDistance >= PULL_THRESHOLD) {
        setIsRefreshing(true);
        haptic("light");
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
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd);
    el.addEventListener('touchcancel', handleTouchEnd);
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  });

  return (
    <div
      ref={containerRef}
      data-pull-to-refresh
      className={cn("relative h-full flex flex-col overflow-x-hidden", className)}
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
        className="flex-1 h-full min-w-0 w-full"
        style={{ y }}
      >
        {children}
      </motion.div>
    </div>
  );
}

import { useState, useRef, useEffect } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  className?: string;
}

const PULL_THRESHOLD = 80;
const MAX_PULL = 120;

export function PullToRefresh({ onRefresh, children, className }: PullToRefreshProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollableRef = useRef<HTMLElement | null>(null);
  const y = useMotionValue(0);

  // Transform y value to opacity/rotation for indicators
  const opacity = useTransform(y, [0, PULL_THRESHOLD], [0, 1]);
  const rotate = useTransform(y, [0, MAX_PULL], [0, 360]);

  // Find the scrollable parent
  useEffect(() => {
    if (containerRef.current) {
      // Look for the ScrollArea viewport or nearest scrolling parent
      // Radix ScrollArea puts the content in a data-radix-scroll-area-viewport
      const scrollAreaViewport = containerRef.current.closest('[data-radix-scroll-area-viewport]');
      if (scrollAreaViewport) {
        scrollableRef.current = scrollAreaViewport as HTMLElement;
      } else {
        // Fallback to window or closest overflow-y-auto
        let parent = containerRef.current.parentElement;
        while (parent) {
            const style = window.getComputedStyle(parent);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                scrollableRef.current = parent;
                break;
            }
            parent = parent.parentElement;
        }
      }
    }
  }, []);

  const handlePan = (_: any, info: any) => {
    if (isRefreshing) return;

    // Only allow pulling if we are at the top of the scroll container
    const scrollTop = scrollableRef.current ? scrollableRef.current.scrollTop : 0;
    
    // We only care about dragging down (delta.y > 0) when at top, or dragging up when already pulled
    if (scrollTop <= 0) {
      const newY = y.get() + info.delta.y * 0.5; // 0.5 friction
      
      if (newY >= 0) {
        // We are pulling down
        y.set(Math.min(newY, MAX_PULL));
      } else {
        // We are scrolling back up / normally
        y.set(0);
      }
    } else {
      y.set(0);
    }
  };

  const handlePanEnd = async () => {
    if (isRefreshing) return;

    if (y.get() > PULL_THRESHOLD) {
      setIsRefreshing(true);
      // Snap to threshold
      animate(y, PULL_THRESHOLD);
      
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        animate(y, 0);
      }
    } else {
      animate(y, 0);
    }
  };

  return (
    <div 
      ref={containerRef} 
      className={cn("relative h-full flex flex-col", className)}
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
        onPan={handlePan}
        onPanEnd={handlePanEnd}
      >
        {children}
      </motion.div>
    </div>
  );
}

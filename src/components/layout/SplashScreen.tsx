import { useEffect, useState, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';
import { getBootProgress, subscribeBootProgress } from '@/lib/bootProgress';
import logo from '@/assets/logo_withoutbg.png';

interface SplashScreenProps {
  className?: string;
}

export function SplashScreen({ className }: SplashScreenProps) {
  const [show, setShow] = useState(false);
  // Real boot milestones (bundle parsed → DB worker → DB ready) reported via
  // reportBootPhase. The bar never hits 100% here — the app replacing the
  // splash is the completion signal.
  const progress = useSyncExternalStore(subscribeBootProgress, getBootProgress);

  useEffect(() => {
    // Small delay to ensure smooth transition
    const timer = setTimeout(() => setShow(true), 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div 
      className={cn(
        "fixed inset-0 z-50 flex flex-col items-center justify-center bg-background transition-opacity duration-500",
        show ? "opacity-100" : "opacity-0",
        className
      )}
    >
      <div className="relative flex flex-col items-center">
        <div className="relative w-32 h-32 mb-8 animate-in fade-in zoom-in duration-700">
          {/* Logo with slight pulse effect */}
          <img 
            src={logo} 
            alt="Journal Logo" 
            className="w-full h-full object-contain drop-shadow-sm animate-pulse-slow"
          />
        </div>
        
        {/* Loading text with animated dots */}
        <div className="flex items-center space-x-1 text-muted-foreground animate-in slide-in-from-bottom-4 duration-700 delay-200 fade-in fill-mode-forwards opacity-0">
          <span className="text-sm font-medium tracking-widest uppercase">Loading</span>
          <span className="flex space-x-1 ml-1">
            <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.3s]"></span>
            <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.15s]"></span>
            <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce"></span>
          </span>
        </div>

        {/* Linear boot progress */}
        <div
          role="progressbar"
          aria-label="Loading progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="mt-6 h-1 w-48 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-foreground/70 transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

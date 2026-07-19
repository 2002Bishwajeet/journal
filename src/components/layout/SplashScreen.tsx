import { useEffect, useState, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';
import { getBootProgress, subscribeBootProgress } from '@/lib/bootProgress';
import logo from '@/assets/logo_withoutbg.png';

interface SplashScreenProps {
  className?: string;
}

// Light-hearted boot quips, rotated while the app loads.
const BOOT_QUIPS = [
  'Sharpening the pencils…',
  'Waking the database elephant…',
  'Untangling the [[wiki links]]…',
  'Dusting off your notebook…',
  'Brewing fresh ink…',
  'Recalling where you left off…',
  'Straightening the margins…',
  'Hiding the key under the mat… kidding, encrypting.',
];

export function SplashScreen({ className }: SplashScreenProps) {
  const [show, setShow] = useState(false);
  // Random start so reloads don't always open on the same quip.
  const [quip, setQuip] = useState(() => Math.floor(Math.random() * BOOT_QUIPS.length));
  // Real boot milestones (bundle parsed → DB worker → DB ready) reported via
  // reportBootPhase. The bar never hits 100% here — the app replacing the
  // splash is the completion signal.
  const progress = useSyncExternalStore(subscribeBootProgress, getBootProgress);

  useEffect(() => {
    // Small delay to ensure smooth transition
    const timer = setTimeout(() => setShow(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setQuip((q) => q + 1), 2500);
    return () => clearInterval(id);
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
        {/* fill-mode-backwards (not opacity-0 + forwards) hides it only during
            the entry delay — the old combo animated opacity 0 → 0, so this row
            was never visible at all. */}
        <div className="flex items-center space-x-1 text-muted-foreground animate-in slide-in-from-bottom-4 duration-700 delay-200 fade-in fill-mode-backwards">
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

        {/* Rotating quip — key remount replays the fade on each change */}
        <p
          key={quip}
          aria-hidden="true"
          className="mt-4 h-4 text-xs text-muted-foreground animate-in fade-in duration-500"
        >
          {BOOT_QUIPS[quip % BOOT_QUIPS.length]}
        </p>
      </div>
    </div>
  );
}

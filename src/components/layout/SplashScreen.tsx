import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo_withoutbg.png';

interface SplashScreenProps {
  className?: string;
}

export function SplashScreen({ className }: SplashScreenProps) {
  const [show, setShow] = useState(false);

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
      </div>
    </div>
  );
}

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface OnlineContextType {
  isOnline: boolean;
}

const OnlineContext = createContext<OnlineContextType>({
  isOnline: true,
});

export const useOnlineContext = () => useContext(OnlineContext);

interface OnlineProviderProps {
  children: ReactNode;
}

export function OnlineProvider({ children }: OnlineProviderProps) {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <OnlineContext.Provider value={{ isOnline }}>
      {children}
    </OnlineContext.Provider>
  );
}

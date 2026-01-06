import { type ReactNode, useMemo } from "react";
import { DotYouClientContext } from "./DotYouClientContext";
import { useAuth } from "@/hooks/auth";

interface DotYouClientProviderProps {
  children: ReactNode;
}

export function DotYouClientProvider({ children }: DotYouClientProviderProps) {
  const { getDotYouClient, isAuthenticated } = useAuth();

  const dotYouClient = useMemo(
    () => getDotYouClient(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAuthenticated]
  );

  return (
    <DotYouClientContext.Provider value={dotYouClient}>
      {children}
    </DotYouClientContext.Provider>
  );
}

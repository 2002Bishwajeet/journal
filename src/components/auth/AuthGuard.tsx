import { type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/auth/useAuth";

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, authenticationState } = useAuth();
  const location = useLocation();

  if (authenticationState === "unknown") {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 border-4 border-foreground/30 border-t-foreground rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground animate-pulse">
            Authenticating...
          </span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    console.debug("[AuthGuard] Not authenticated, redirecting to /welcome");
    const target = location.pathname + location.search + location.hash;
    const returnUrlParam =
      target === "/" ? "" : `?returnUrl=${encodeURIComponent(target)}`;
    return <Navigate to={`/welcome${returnUrlParam}`} replace />;
  }

  return <>{children}</>;
}

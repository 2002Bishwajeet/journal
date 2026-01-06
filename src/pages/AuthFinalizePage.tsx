import { useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useYouAuthAuthorization } from "@/hooks/auth/useYouAuthAuthorization";

export default function AuthFinalizePage() {
  const isRunning = useRef(false);
  const hasRedirected = useRef(false);
  const [searchParams] = useSearchParams();
  const { finalizeAuthorization } = useYouAuthAuthorization();
  const [finalizeState, setFinalizeState] = useState<
    undefined | "success" | "error"
  >();

  const identity = searchParams.get("identity");
  const publicKey = searchParams.get("public_key");
  const salt = searchParams.get("salt");
  const returnUrl = searchParams.get("state");

  useEffect(() => {
    (async () => {
      if (!identity || !publicKey || !salt) return;
      if (isRunning.current) return;

      isRunning.current = true;
      try {
        const success = await finalizeAuthorization(identity, publicKey, salt);
        setFinalizeState(success ? "success" : "error");
      } catch (error) {
        console.error("Finalization error:", error);
        setFinalizeState("error");
      }
    })();
  }, [identity, publicKey, salt, finalizeAuthorization]);

  useEffect(() => {
    if (finalizeState !== "success") return;
    if (hasRedirected.current) return;

    hasRedirected.current = true;
    const targetUrl = returnUrl || "/";
    // Use a full navigation instead of client-side routing when auth completes.
    window.location.assign(targetUrl);
  }, [finalizeState, returnUrl]);

  if (!identity || !publicKey || !salt) {
    return <Navigate to="/welcome" replace />;
  }

  if (finalizeState === "error") {
    return <Navigate to="/welcome?error=auth_failed" replace />;
  }

  // Loading state
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-foreground/30 border-t-foreground rounded-full animate-spin" />
        <div className="text-center">
          <h1 className="text-lg font-medium text-foreground mb-1">
            Completing sign in
          </h1>
          <p className="text-sm text-muted-foreground animate-pulse">
            Verifying your identity...
          </p>
        </div>
      </div>
    </div>
  );
}

import { useState, useRef, useTransition, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/auth/useAuth";
import { useYouAuthAuthorization } from "@/hooks/auth/useYouAuthAuthorization";
import logo from "@/assets/logo_withoutbg.png";

export default function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { getAuthorizationParameters, getAuthUrl, checkIdentity } =
    useYouAuthAuthorization();
  const [identity, setIdentity] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/");
    }
    inputRef.current?.focus();
  }, [navigate, isAuthenticated]);

  const handleLogin = () => {
    if (!identity.trim()) {
      setError("Please enter your Homebase identity");
      return;
    }

    setError(null);

    startTransition(async () => {
      try {
        // Validate identity before initiating OAuth
        const isValidIdentity = await checkIdentity(identity.trim());
        if (!isValidIdentity) {
          setError("Invalid Homebase identity. Please check and try again.");
          return;
        }

        const authParams = await getAuthorizationParameters(
          window.location.origin
        );
        const fullAuthUrl = getAuthUrl(identity.trim(), authParams);
        window.location.href = fullAuthUrl;
      } catch (err) {
        console.error("Auth error:", err);
        setError("Failed to connect. Please try again.");
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleLogin();
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-background font-sans text-foreground selection:bg-stone-200 selection:text-black">
      {/* Left Side - Landing / Branding */}
      <div className="hidden lg:flex w-1/2 bg-secondary/30 relative flex-col justify-between p-16 xl:p-24 border-r border-border/50">
        <div className="z-10">
          <div className="flex items-center gap-4 mb-12">
            <div className="w-12 h-12 rounded-xl bg-white shadow-sm flex items-center justify-center overflow-hidden p-1.5 ring-1 ring-border/50">
              <img
                src={logo}
                alt="Journal Logo"
                className="w-full h-full object-contain opacity-90"
              />
            </div>
            <span className="text-3xl font-script text-foreground tracking-wide opacity-90">
              Journal
            </span>
          </div>
          <h1 className="text-6xl font-serif text-foreground leading-[1.05] mb-8 max-w-lg tracking-tight">
            Capture your thoughts with clarity and calm.
          </h1>
          <p className="text-xl text-muted-foreground max-w-md leading-relaxed font-light">
            A minimalist space for your intellectual journey. Distraction-free,
            by design.
          </p>
        </div>

        <div className="z-10">
          <div className="flex gap-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-500 ${
                  i === 1
                    ? "w-12 bg-foreground/40"
                    : "w-2 bg-foreground/10 hover:bg-foreground/20"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Abstract Background Element */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70%] h-[70%] bg-white/60 blur-[120px] rounded-full pointer-events-none mix-blend-soft-light" />
      </div>

      {/* Right Side - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 lg:p-24 relative bg-background/50">
        <div className="w-full max-w-90 space-y-10 animate-in fade-in slide-in-from-bottom-8 duration-1000 ease-out fill-mode-forwards">
          <div className="text-center space-y-4">
            <div className="lg:hidden flex justify-center mb-8">
              <div className="w-16 h-16 rounded-2xl bg-white shadow-sm flex items-center justify-center overflow-hidden p-2 border border-border/50 ">
                <img
                  src={logo}
                  alt="Journal Logo"
                  className="w-full h-full object-contain opacity-90"
                />
              </div>
            </div>
            <h2 className="text-2xl font-medium tracking-tight text-foreground">
              Welcome back
            </h2>
            <p className="text-muted-foreground text-sm">
              Enter your Homebase ID to continue
            </p>
          </div>

          <div className="space-y-6">
            {error && (
              <div className="p-4 text-sm bg-red-50 text-red-600 border border-red-100 rounded-lg animate-in fade-in zoom-in-95 duration-200">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="identity"
                className="text-xs font-medium text-muted-foreground ml-1"
              >
                Identity
              </label>
              <div className="relative group">
                <Input
                  ref={inputRef}
                  id="identity"
                  type="text"
                  value={identity}
                  onChange={(e) => setIdentity(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="johndoe.com"
                  disabled={isPending}
                  autoComplete="username"
                  aria-autocomplete="list"
                  aria-label="Identity"
                  aria-describedby="identity-description"
                  className="h-11 px-4 bg-transparent border-input hover:border-foreground/20 focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-input transition-all duration-200 shadow-sm rounded-lg text-sm"
                />
              </div>
            </div>

            <Button
              className="w-full h-11 text-sm font-medium rounded-lg shadow-sm hover:shadow transition-all duration-200 cursor-pointer"
              onClick={handleLogin}
              disabled={isPending}
            >
              {isPending ? (
                <div className="flex items-center gap-2">
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Connecting...</span>
                </div>
              ) : (
                "Continue"
              )}
            </Button>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            New here?{" "}
            <a
              href="https://homebase.id"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground font-medium underline-offset-4 hover:underline transition-all"
            >
              Create an identity
            </a>
          </p>
        </div>

        {/* Footer copyright for mobile/desktop */}
        <div className="absolute bottom-6 w-full text-center text-[10px] text-muted-foreground/50 uppercase tracking-widest">
          © 2025 Journal App
        </div>
      </div>
    </div>
  );
}

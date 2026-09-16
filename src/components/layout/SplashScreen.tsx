import { useEffect, useState, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';
import { getBootProgress, getBootError, getBootFailureCount, subscribeBootProgress } from '@/lib/bootProgress';
import { Button } from '@/components/ui/button';
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

/**
 * Shown when the database can't be opened at all — most often a legacy
 * migration that couldn't run (its engine is fetched on demand, so an offline
 * first launch after the upgrade fails here). The app deliberately does not
 * boot an empty database in that case, so this is a dead end until a retry
 * succeeds. Nothing has been migrated or deleted; the old data is still there.
 *
 * Retry stays in this session on purpose: the opt-out below appears only after
 * a repeat failure, and telling the user to reload would reset that count.
 */
export function BootErrorScreen() {
  const error = useSyncExternalStore(subscribeBootProgress, getBootError);
  const failures = useSyncExternalStore(subscribeBootProgress, getBootFailureCount);
  const [busy, setBusy] = useState(false);

  if (!error) return null;

  // Only the migration's own failures are escapable — LegacyMigrationError is
  // thrown solely when a legacy database exists and could not be dumped.
  const isLegacyFailure = error.name === 'LegacyMigrationError';

  const attempt = async (run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
      // Reload rather than patch state: every query that failed needs re-running.
      window.location.reload();
    } catch {
      // The new error is already published — stay on this screen.
      setBusy(false);
    }
  };

  // Imported lazily so the boot path's module graph stays unchanged. Retry must
  // go through retryDatabase(): getDatabase() caches the rejection, so it would
  // hand back the same failure without trying again.
  const handleRetry = () =>
    attempt(async () => {
      const { retryDatabase } = await import('@/lib/db');
      await retryDatabase();
    });

  const handleSkipLegacy = () =>
    attempt(async () => {
      const { bootWithoutLegacyData } = await import('@/lib/db');
      await bootWithoutLegacyData();
    });

  return (
    <div
      role="alert"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background px-6 text-center"
    >
      <img src={logo} alt="" className="h-16 w-16 object-contain opacity-70" />
      <div className="space-y-1">
        <h1 className="text-base font-medium">Couldn't open your journal</h1>
        <p className="max-w-xs text-xs text-muted-foreground">
          Your notes are safe on this device. Reconnect and try again to finish opening them.
        </p>
        <p className="max-w-xs break-words font-mono text-xs text-muted-foreground/70">{error.message}</p>
      </div>
      <Button onClick={handleRetry} disabled={busy} size="sm">
        {busy ? 'Retrying…' : 'Retry'}
      </Button>
      {/* Only for a failure of the legacy migration itself, only after it has
          failed twice, and only as an explicit choice: this opens an empty
          journal, so it must never happen on its own. An unrelated failure
          (say the engine not downloading while offline) is not a reason to
          leave someone's notes behind. */}
      {isLegacyFailure && failures >= 2 && (
        <div className="space-y-1">
          <Button onClick={handleSkipLegacy} disabled={busy} size="sm" variant="ghost">
            Open without my old notes
          </Button>
          <p className="max-w-xs text-xs text-muted-foreground/70">
            Starts an empty journal. Your old notes stay on this device untouched, but this app
            won't show them until a future update can move them across.
          </p>
        </div>
      )}
    </div>
  );
}

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

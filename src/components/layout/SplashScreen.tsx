import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { LockKeyhole } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getBootProgress, getBootError, getBootFailureCount, subscribeBootProgress } from '@/lib/bootProgress';
import { useOpenProgress } from '@/hooks/useOpenProgress';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import logo from '@/assets/logo_withoutbg.png';
import { APP_NAME } from '@/lib/native';

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
 * How long the splash shows before it gives way to a "taking too long" screen
 * with a Reload button (#806): a reload in iOS Safari once left it up for minutes.
 * The app still replaces that screen if the boot finishes after all.
 */
export const BOOT_TIMEOUT_MS = 20_000;

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
  // The native app's encrypted database can't be opened (#1362): its keychain key is
  // gone, or the store is damaged. Retry can't fix either; a reset can.
  const keyMissing = error.name === 'DatabaseKeyMissingError';
  const offersReset = keyMissing || error.name === 'CorruptStoreError';
  // The app lock (#1363), and a Linux without a keychain: neither shows a note.
  const locked = error.name === 'DatabaseLockedError';
  const needsPassphrase = error.name === 'PassphraseNeededError';

  const attempt = async (run: () => Promise<unknown>, reload = true) => {
    setBusy(true);
    try {
      await run();
      // Reload rather than patch state: every query that failed needs re-running.
      if (reload) window.location.reload();
      else setBusy(false);
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

  // Never on its own: only this button deletes the local data.
  const handleReset = () =>
    attempt(async () => {
      const { resetLocalData } = await import('@/lib/db/localReset');
      await resetLocalData();
    });

  // Unlock asks Touch ID, Windows Hello, Face ID or a fingerprint through the key command again.
  const handleUnlock = () =>
    attempt(async () => {
      const { clearLockedSession } = await import('@/lib/appLock');
      clearLockedSession();
      const { retryDatabase } = await import('@/lib/db');
      await retryDatabase();
    });

  if (locked) {
    return (
      <div
        role="alert"
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background px-6 text-center"
      >
        <LockKeyhole aria-hidden="true" className="size-10 text-muted-foreground" />
        <div className="space-y-1">
          <h1 className="text-base font-medium">{APP_NAME} is locked</h1>
          {'reason' in error && error.reason === 'failed' && (
            <p className="max-w-xs text-xs text-muted-foreground">Couldn't confirm it's you. Try again.</p>
          )}
        </div>
        <Button onClick={handleUnlock} disabled={busy} size="sm">
          {busy ? 'Unlocking…' : 'Unlock'}
        </Button>
      </div>
    );
  }

  if (needsPassphrase) {
    const isNew = 'isNew' in error && error.isNew === true;
    const wrong = 'wrong' in error && error.wrong === true;
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const value = new FormData(event.currentTarget).get('passphrase');
      if (typeof value !== 'string' || !value) return;
      void attempt(async () => {
        const { setPassphrase } = await import('@/lib/db/databaseKey');
        setPassphrase(value);
        const { retryDatabase } = await import('@/lib/db');
        await retryDatabase();
        // No reload, which would forget the passphrase: the app renders once the database is open (nativeBoot.ts).
      }, false);
    };
    return (
      <div
        role="alert"
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background px-6 text-center"
      >
        <LockKeyhole aria-hidden="true" className="size-10 text-muted-foreground" />
        <div className="space-y-1">
          <h1 className="text-base font-medium">{isNew ? 'Choose a passphrase' : 'Enter your passphrase'}</h1>
          <p className="max-w-xs text-xs text-muted-foreground">
            This computer has no keychain, so a passphrase protects the notes {APP_NAME} keeps on it.
            {isNew && " It can't be recovered: if you forget it, reset the local data and sync again."}
          </p>
          {wrong && (
            <p className="max-w-xs text-xs text-destructive dark:text-red-400">That passphrase didn't open your notes.</p>
          )}
        </div>
        <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-2">
          <Input name="passphrase" type="password" aria-label="Passphrase" autoComplete={isNew ? 'new-password' : 'current-password'} autoFocus />
          <Button type="submit" disabled={busy} size="sm">
            {busy ? 'Opening…' : 'Unlock'}
          </Button>
        </form>
        {wrong && (
          <Button onClick={handleReset} disabled={busy} size="sm" variant="ghost">
            Reset local data and sync again
          </Button>
        )}
      </div>
    );
  }

  if (offersReset) {
    return (
      <div
        role="alert"
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background px-6 text-center"
      >
        <img src={logo} alt="" className="h-16 w-16 object-contain opacity-70" />
        <div className="space-y-1">
          <h1 className="text-base font-medium">Couldn't open the notes on this device</h1>
          <p className="max-w-xs text-xs text-muted-foreground">
            {keyMissing
              ? 'The key to them is missing from the system keychain.'
              : 'The local copy is damaged.'}{' '}
            Your synced notes are safe in your Homebase: reset the local data to download them again.
            Changes on this device that haven't synced yet will be lost.
          </p>
        </div>
        <Button onClick={handleReset} disabled={busy} size="sm" variant="destructive">
          {busy ? 'Resetting…' : 'Reset local data and sync again'}
        </Button>
      </div>
    );
  }

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
  // Random start so reloads don't always open on the same quip.
  const [quip, setQuip] = useState(() => Math.floor(Math.random() * BOOT_QUIPS.length));
  // Real boot milestones (bundle parsed → DB worker → DB ready) reported via
  // reportBootPhase. The bar never hits 100% here — the app replacing the
  // splash is the completion signal.
  const progress = useSyncExternalStore(subscribeBootProgress, getBootProgress);
  // A slow encrypted open on Android (#1365): how many of its blocks are read.
  const openPercent = useOpenProgress();

  useEffect(() => {
    const id = setInterval(() => setQuip((q) => q + 1), 2500);
    return () => clearInterval(id);
  }, []);

  // From mount, not page load: the splash also covers loads later in a session.
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setStalled(true), BOOT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  if (stalled) {
    return (
      <div
        role="alert"
        data-boot-stalled=""
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background px-6 text-center"
      >
        <img src={logo} alt="" className="h-16 w-16 object-contain opacity-70" />
        <div className="space-y-1">
          <h1 className="text-base font-medium">{APP_NAME} is taking too long to open</h1>
          <p className="max-w-xs text-xs text-muted-foreground">
            Your notes are safe on this device. Reloading usually gets it going again.
          </p>
        </div>
        <Button onClick={() => window.location.reload()} size="sm">
          Reload
        </Button>
      </div>
    );
  }

  return (
    <div 
      data-splash
      className={cn(
        "fixed inset-0 z-50 flex flex-col items-center justify-center bg-background",
        className
      )}
    >
      <div className="relative flex flex-col items-center">
        {/* No entry animation: the logo is already here in the iOS launch image and
            index.html's static first frame, so it must not vanish and zoom back in. */}
        <div className="relative w-32 h-32 mb-8">
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
        {openPercent === null ? (
          <p
            key={quip}
            aria-hidden="true"
            className="mt-4 h-4 text-xs text-muted-foreground animate-in fade-in duration-500"
          >
            {BOOT_QUIPS[quip % BOOT_QUIPS.length]}
          </p>
        ) : (
          <p className="mt-4 h-4 text-xs tabular-nums text-muted-foreground">Opening your notes… {openPercent}%</p>
        )}
      </div>
    </div>
  );
}

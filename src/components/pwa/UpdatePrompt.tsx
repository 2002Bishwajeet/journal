import { useRegisterSW } from 'virtual:pwa-register/react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { isRunningBuild } from '@/lib/swBuild';

export function UpdatePrompt() {
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined);

  const {
    needRefresh: [, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
      registrationRef.current = registration;
    },
    onOfflineReady() {
      toast.success("App ready to work offline");
    },
    async onNeedRefresh() {
      // A launch after a deploy already runs the new bundle (the root page comes from the network)
      // while its worker waits behind the old one: let it take over without asking or reloading.
      const waiting = (await navigator.serviceWorker.getRegistration())?.waiting;
      if (await isRunningBuild(waiting)) {
        setNeedRefresh(false);
        toast.dismiss("sw-update");
        waiting?.postMessage({ type: 'SKIP_WAITING' });
        return;
      }
      toast.info("New version available", {
        id: "sw-update",
        description: "A new version of the app is available. Click to update.",
        duration: Infinity,
        action: {
          label: "Update",
          onClick: () => {
            updateServiceWorker(true);
          },
        },
        cancel: {
          label: "Dismiss",
          onClick: () => setNeedRefresh(false),
        },
      });
    },
    // A worker taking over reloads the page onto its build, unless the page already runs it.
    async onNeedReload() {
      if (!(await isRunningBuild(navigator.serviceWorker.controller))) window.location.reload();
    },
    onRegisterError(error: unknown) {
      console.error('SW registration error', error);
    },
  });

  // An open tab would otherwise sit on the old bundle until the hourly poll
  // fires. Checking when the tab comes back to the foreground surfaces the
  // prompt as soon as the user returns to it; the interval is just a backstop
  // for a tab that stays visible for hours.
  useEffect(() => {
    let lastCheck = 0;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      // ponytail: fixed 60s floor so rapid tab switching can't spam the
      // conditional GET for sw.js. Make it adaptive only if that shows up.
      const now = Date.now();
      if (now - lastCheck < 60 * 1000) return;
      lastCheck = now;
      registrationRef.current?.update();
    };

    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    const id = setInterval(check, 60 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
      clearInterval(id);
    };
  }, []);

  return null;
}

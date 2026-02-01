import { useRegisterSW } from 'virtual:pwa-register/react';
import { useEffect } from 'react';
import { toast } from 'sonner';

export function UpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r: ServiceWorkerRegistration | undefined) {
      // Checked every hour
      if (r) {
        setInterval(() => {
          r.update();
        }, 60 * 60 * 1000);
      }
    },
    onRegisterError(error: unknown) {
      console.error('SW registration error', error);
    },
  });

  useEffect(() => {
    if (offlineReady) {
      toast.success("App ready to work offline");
      setOfflineReady(false);
    }
  }, [offlineReady, setOfflineReady]);

  useEffect(() => {
    if (needRefresh) {
      toast.info("New version available", {
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
    }
  }, [needRefresh, updateServiceWorker, setNeedRefresh]);

  return null;
}

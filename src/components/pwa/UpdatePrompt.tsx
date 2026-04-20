import { useRegisterSW } from 'virtual:pwa-register/react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

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
    onNeedRefresh() {
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
    },
    onRegisterError(error: unknown) {
      console.error('SW registration error', error);
    },
  });

  // Periodically check for SW updates (every hour) with proper cleanup
  useEffect(() => {
    const id = setInterval(() => {
      registrationRef.current?.update();
    }, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  return null;
}

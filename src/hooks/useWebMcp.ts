import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDotYouClientContext } from '@/components/auth';
import { AGENT_GRANTS_QUERY_KEY } from '@/hooks/useAgentGrants';
import { AgentGrantsDriveProvider } from '@/lib/homebase/AgentGrantsDriveProvider';
import { getModelContext } from '@/lib/agent/modelContext';
import { WEBMCP_ENABLED_KEY, readString, writeString } from '@/lib/storage';

// The switch is per device, so it lives in localStorage (see lib/storage.ts).
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

const getEnabled = () => readString(WEBMCP_ENABLED_KEY) === 'true';

/** Whether the browser has WebMCP, and the device's switch for letting its agent use Journal. */
export function useWebMcpSetting() {
  const enabled = useSyncExternalStore(subscribe, getEnabled);
  return {
    supported: getModelContext() !== null,
    enabled,
    setEnabled(next: boolean) {
      writeString(WEBMCP_ENABLED_KEY, String(next));
      listeners.forEach((listener) => listener());
    },
  };
}

/**
 * Registers Journal's tools with WebMCP while the switch is on and the browser has it.
 * The module loads only then. Turning the switch off aborts every registration.
 */
export function useWebMcpBridge() {
  const client = useDotYouClientContext();
  const queryClient = useQueryClient();
  const { enabled } = useWebMcpSetting();

  useEffect(() => {
    // Read here, not in render: the React Compiler would keep the answer from the first render.
    const modelContext = enabled ? getModelContext() : null;
    if (!modelContext) return;
    let cancelled = false;
    let stop = () => {};

    void (async () => {
      const [{ startWebMcp }, { createLocalDeps }] = await Promise.all([
        import('@/lib/agent/webmcp'),
        import('@/lib/agent/local/localDeps'),
      ]);
      if (cancelled) return;
      const loadGrants = async () =>
        (
          await queryClient.ensureQueryData({
            queryKey: AGENT_GRANTS_QUERY_KEY,
            queryFn: () => new AgentGrantsDriveProvider(client).load(),
          })
        ).grants;
      const handle = await startWebMcp({ modelContext, deps: { ...createLocalDeps(), loadGrants } });
      // A grant changed in Settings can make the open note writable, or not.
      const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
        if (event.type === 'updated' && event.action.type === 'success' && event.query.queryKey[0] === AGENT_GRANTS_QUERY_KEY[0]) {
          void handle.sync();
        }
      });
      stop = () => {
        unsubscribe();
        handle.stop();
      };
      if (cancelled) stop();
    })().catch((error) => console.error('WebMCP: could not register the tools.', error));

    return () => {
      cancelled = true;
      stop();
    };
  }, [enabled, client, queryClient]);
}

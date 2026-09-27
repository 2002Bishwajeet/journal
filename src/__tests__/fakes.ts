/**
 * Shared fake-object factories for tests, so the cast each one needs lives
 * in exactly one place instead of being repeated per file.
 */
import type { DotYouClient } from '@homebase-id/js-lib/core';
import type { OnlineContextType } from '@/contexts/OnlineContext';

export function fakeDotYouClient(identity = 'me.dotyou.cloud'): DotYouClient {
  return { getHostIdentity: () => identity } as unknown as DotYouClient;
}

export function fakeOnlineContext(overrides?: Partial<OnlineContextType>): OnlineContextType {
  return { isOnline: true, ...overrides };
}

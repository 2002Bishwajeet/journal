import { useLayoutEffect, useState } from 'react';

// Any function type is assignable to this one; it is called back with its own arguments.
type Handler = (...args: never[]) => unknown;
type Callable = (...args: unknown[]) => unknown;
type Handlers = Record<string, Handler | undefined>;

/** Holds the latest handlers and one fixed function per key that calls the latest one. */
class LatestHandlers<T extends Handlers> {
  private latest: T;
  readonly stable: T;

  constructor(handlers: T) {
    this.latest = handlers;
    this.stable = Object.fromEntries(
      Object.keys(handlers).map((key) => [key, (...args: unknown[]) => (this.latest[key] as Callable | undefined)?.(...args)]),
    ) as unknown as T;
  }

  update(handlers: T): void {
    this.latest = handlers;
  }
}

/**
 * The same handlers, with an identity that never changes: each one calls the latest
 * handler passed in. A handler passed as undefined stays undefined, so "is there an
 * action" checks still work. The keys must be the same on every render.
 *
 * For props of memoized list rows (#1219): the layout's handlers close over the note
 * list and the open tabs, so they change on every list emission, and each change
 * re-rendered every visible row.
 */
export function useStableHandlers<T extends Handlers>(handlers: T): T {
  const [box] = useState(() => new LatestHandlers(handlers));
  useLayoutEffect(() => {
    box.update(handlers);
  });
  return Object.fromEntries(
    Object.keys(handlers).map((key) => [key, handlers[key] && box.stable[key]]),
  ) as T;
}

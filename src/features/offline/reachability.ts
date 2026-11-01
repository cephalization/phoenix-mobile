import { create } from 'zustand';

/**
 * Whether each Phoenix instance answered its last request. The device can be
 * online while a server is not (a LAN server away from home), so reachability
 * is tracked per instance from real requests rather than from the network
 * state alone. Nothing here is persisted: every launch starts `unknown`.
 */
export type Reachability = 'unknown' | 'online' | 'offline';

export type InstanceReachability = {
  state: Reachability;
  /** When the instance last answered any request, in epoch milliseconds. */
  lastReachedAt: number | null;
};

type ReachabilityState = {
  /** The device has a network connection at all (Wi-Fi, cellular, or Ethernet). */
  deviceOnline: boolean;
  instances: Record<string, InstanceReachability>;
  setDeviceOnline: (online: boolean) => void;
  markReachable: (instanceId: string) => void;
  markUnreachable: (instanceId: string) => void;
  forget: (instanceId: string) => void;
};

const Unknown: InstanceReachability = { state: 'unknown', lastReachedAt: null };

export const useReachabilityStore = create<ReachabilityState>()((set) => ({
  deviceOnline: true,
  instances: {},
  setDeviceOnline: (deviceOnline) =>
    set((state) => (state.deviceOnline === deviceOnline ? state : { deviceOnline })),
  markReachable: (instanceId) =>
    set((state) => ({
      instances: {
        ...state.instances,
        [instanceId]: { state: 'online', lastReachedAt: Date.now() },
      },
    })),
  markUnreachable: (instanceId) =>
    set((state) => {
      const current = state.instances[instanceId] ?? Unknown;

      if (current.state === 'offline') return state;

      return {
        instances: { ...state.instances, [instanceId]: { ...current, state: 'offline' } },
      };
    }),
  forget: (instanceId) =>
    set((state) => ({
      instances: Object.fromEntries(
        Object.entries(state.instances).filter(([id]) => id !== instanceId),
      ),
    })),
}));

/** An instance's reachability; `offline` also when the device has no network. */
export function useInstanceReachability(instanceId: string | undefined): InstanceReachability {
  // Each selector returns a value already in the store: a selector that built
  // a new object would never compare equal, and React would re-render forever.
  const entry = useReachabilityStore((state) =>
    instanceId ? (state.instances[instanceId] ?? Unknown) : Unknown,
  );

  const deviceOnline = useReachabilityStore((state) => state.deviceOnline);

  return deviceOnline || entry.state === 'offline' ? entry : { ...entry, state: 'offline' };
}

/** The same answer outside React, for request code and the outbox. */
export function instanceReachability(instanceId: string): Reachability {
  const state = useReachabilityStore.getState();

  if (!state.deviceOnline) return 'offline';

  return state.instances[instanceId]?.state ?? 'unknown';
}

/**
 * Calls `listener` each time an instance becomes reachable again after being
 * offline (or after the device regains a network), so queued work can resume.
 */
export function onInstanceReachable(listener: (instanceId: string) => void): () => void {
  return useReachabilityStore.subscribe((state, previous) => {
    for (const [instanceId, entry] of Object.entries(state.instances)) {
      const before = previous.instances[instanceId]?.state;
      const wasBlocked = before !== 'online' || !previous.deviceOnline;

      if (entry.state === 'online' && state.deviceOnline && wasBlocked) listener(instanceId);
    }
  });
}

/**
 * True for the errors `fetch` throws when a request never reached a server:
 * no route, refused connection, DNS failure, or a timeout. HTTP error statuses
 * are not network failures; they mean the server answered.
 */
export function isNetworkFailure(error: unknown): error is Error {
  return error instanceof Error && isNetworkError(error);
}

function isNetworkError(error: Error): boolean {
  if (error.name === 'TimeoutError') return true;

  return (
    error instanceof TypeError &&
    /network request failed|failed to fetch|load failed|networkerror|network connection was lost|could not connect|timed out|offline/i.test(
      error.message,
    )
  );
}

/**
 * A network failure anywhere in an error's `cause` chain. Session-review
 * requests wrap the thrown `fetch` error in their own error type, so the
 * failure can sit a few links down.
 */
export function causedByNetworkFailure(error: Error): boolean {
  let current: Error | undefined = error;

  for (let depth = 0; current && depth < 8; depth += 1) {
    if (isNetworkError(current)) return true;
    current = current.cause instanceof Error ? current.cause : undefined;
  }

  return false;
}

/**
 * Runs one request for an instance and records whether the server answered.
 * Every Phoenix request goes through `authenticatedFetch`, which uses this.
 *
 * Once a server is known to be unreachable while the device is online, other
 * requests fail at once instead of waiting out the platform's network timeout
 * (a minute on iOS, for a LAN host that isn't there); only the reachability
 * probe (`probe: true`) still goes out, and its answer reopens the gate.
 * A request already waiting when a probe finds the server gone fails then too,
 * rather than spinning until the platform gives up.
 */
export async function trackReachability(
  instanceId: string,
  request: () => Promise<Response>,
  { probe = false }: { probe?: boolean } = {},
): Promise<Response> {
  const { deviceOnline, instances, markReachable, markUnreachable } =
    useReachabilityStore.getState();

  if (!probe && deviceOnline && instances[instanceId]?.state === 'offline') {
    throw new TypeError('Network request failed: the Phoenix server is unreachable.');
  }

  try {
    const response = probe ? await request() : await untilUnreachable(instanceId, request());

    markReachable(instanceId);

    return response;
  } catch (error) {
    // A probe's only failure mode is "no answer"; React Native reports its
    // timeout as a plain AbortError, which isNetworkFailure can't tell from a
    // cancelled request.
    if (probe || isNetworkFailure(error)) markUnreachable(instanceId);
    throw error;
  }
}

/**
 * Settles with `request`, or rejects with a network failure as soon as the
 * instance turns unreachable while it waits. The request itself is left to
 * finish or time out; its answer no longer matters.
 */
async function untilUnreachable(instanceId: string, request: Promise<Response>): Promise<Response> {
  let unsubscribe = () => {};

  const unreachable = new Promise<never>((_resolve, reject) => {
    unsubscribe = useReachabilityStore.subscribe((state, previous) => {
      const now = state.instances[instanceId]?.state;
      const before = previous.instances[instanceId]?.state;

      if (now === 'offline' && before !== 'offline') {
        reject(new TypeError('Network request failed: the Phoenix server is unreachable.'));
      }
    });
  });

  try {
    return await Promise.race([request, unreachable]);
  } finally {
    unsubscribe();
  }
}

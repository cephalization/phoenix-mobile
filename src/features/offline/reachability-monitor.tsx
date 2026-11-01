import { onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useInstanceStore } from '@/store/instances';
import type { PhoenixInstance } from '@/types/instance';

import { instanceReachability, trackReachability, useReachabilityStore } from './reachability';

const ProbeIntervalMs = 10_000;
const ProbeTimeoutMs = 5_000;

// The instance on screen is also checked while it looks fine, more slowly, so
// the offline notice appears even when nothing on screen is fetching.
const HeartbeatIntervalMs = 30_000;

/**
 * Keeps reachability current without a request from the user: follows the
 * device's network (and tells TanStack Query, which then pauses rather than
 * fails), and while the app is active re-checks every server that last
 * failed, so cached screens and queued changes notice it coming back.
 * A connection counts even without internet, since Phoenix is often on a LAN.
 */
export function ReachabilityMonitor() {
  const instances = useInstanceStore((state) => state.instances);

  useEffect(() => {
    const apply = (connected: boolean) => {
      useReachabilityStore.getState().setDeviceOnline(connected);
      onlineManager.setOnline(connected);
    };

    void Network.getNetworkStateAsync().then((state) => apply(state.isConnected !== false));

    const subscription = Network.addNetworkStateListener((state) => {
      apply(state.isConnected !== false);

      // Leaving Wi-Fi for cellular (or dropping a VPN) keeps the device online
      // but can strand a LAN server, so every server is checked at once
      // instead of waiting for a request to time out.
      if (state.isConnected !== false) {
        for (const instance of useInstanceStore.getState().instances) void probe(instance);
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const probeOffline = () => {
      if (!useReachabilityStore.getState().deviceOnline) return;

      for (const instance of instances) {
        if (instanceReachability(instance.id) === 'offline') void probe(instance);
      }
    };

    // At launch nothing is known yet; a short probe settles it within seconds,
    // so a missing LAN server shows as offline before the first real request
    // has waited out its timeout.
    const probeUnknown = () => {
      for (const instance of instances) {
        if (useReachabilityStore.getState().instances[instance.id] === undefined) {
          void probe(instance);
        }
      }
    };

    const heartbeat = () => {
      // Read at each beat, so switching instance needs no restart.
      const { activeInstanceId } = useInstanceStore.getState();

      const active = instances.find((instance) => instance.id === activeInstanceId) ?? instances[0];

      if (!active || !useReachabilityStore.getState().deviceOnline) return;

      if (instanceReachability(active.id) === 'online') void probe(active);
    };

    let interval: ReturnType<typeof setInterval> | null = null;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      probeUnknown();
      probeOffline();
      interval ??= setInterval(probeOffline, ProbeIntervalMs);
      heartbeatInterval ??= setInterval(heartbeat, HeartbeatIntervalMs);
    };

    const stop = () => {
      if (interval !== null) clearInterval(interval);

      if (heartbeatInterval !== null) clearInterval(heartbeatInterval);
      interval = null;
      heartbeatInterval = null;
    };

    if (AppState.currentState === 'active') start();

    const subscription = AppState.addEventListener('change', (state) =>
      state === 'active' ? start() : stop(),
    );

    const offNetwork = useReachabilityStore.subscribe((state, previous) => {
      if (state.deviceOnline && !previous.deviceOnline) probeOffline();
    });

    return () => {
      stop();
      subscription.remove();
      offNetwork();
    };
  }, [instances]);

  return null;
}

/**
 * Asks the server for its version, which needs no sign-in, with a short
 * timeout. It bypasses the fail-fast gate in `trackReachability`, so it is the
 * one request that can find an unreachable server again.
 */
async function probe(instance: PhoenixInstance) {
  // A plain controller and timer: React Native's AbortSignal.timeout support varies.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ProbeTimeoutMs);

  try {
    await trackReachability(
      instance.id,
      () =>
        fetch(`${instance.baseUrl.replace(/\/+$/, '')}/arize_phoenix_version`, {
          signal: controller.signal,
        }),
      { probe: true },
    );
  } catch {
    // Still unreachable; the next probe tries again.
  } finally {
    clearTimeout(timeout);
  }
}

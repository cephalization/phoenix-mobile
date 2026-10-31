import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { Platform, StyleSheet } from 'react-native';

import {
  LayoutMetricsView,
  supportsSplitColumns,
  type NativeLayoutMetrics,
} from '../../../modules/duo-native';

export type { NativeLayoutMetrics, ReservedRegion } from '../../../modules/duo-native';

/** Metrics for the whole window, published once the native view first measures. */
const WindowMetricsContext = createContext<NativeLayoutMetrics | null>(null);

/** Metrics for the native split column the reader sits in, or null outside one. */
export const ColumnMetricsContext = createContext<NativeLayoutMetrics | null>(null);

/**
 * How long to wait for the first native metrics before choosing a navigator.
 * The metrics view assumes "no hinge" a quarter second after it attaches, so
 * this only matters when the native module is missing.
 */
const MetricsTimeoutMs = 1000;

/**
 * Renders the native metrics view absolutely over its parent and reports what
 * it measures. Nothing renders where the native module is unavailable.
 */
export function LayoutMetricsObserver({
  onChange,
}: {
  onChange: (metrics: NativeLayoutMetrics) => void;
}) {
  if (LayoutMetricsView === null) return null;

  return (
    <LayoutMetricsView
      onMetricsChange={(event) => onChange(event.nativeEvent)}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
    />
  );
}

/**
 * Publishes window metrics and reports, once, whether the window lays the app
 * out in native split columns. The choice is fixed for the session: switching
 * navigators would remount every screen, and the split collapses on its own
 * when iPhone Duo closes.
 */
export function NativeMetricsProvider({
  children,
}: {
  children: (state: { ready: boolean; columns: boolean }) => ReactNode;
}) {
  const [metrics, setMetrics] = useState<NativeLayoutMetrics | null>(null);
  const [timedOut, setTimedOut] = useState(LayoutMetricsView === null);
  const [columns, setColumns] = useState<boolean | null>(null);

  useEffect(() => {
    if (timedOut) return;
    const timeout = setTimeout(() => setTimedOut(true), MetricsTimeoutMs);

    return () => clearTimeout(timeout);
  }, [timedOut]);

  const decided = columns ?? (metrics !== null ? columnsFor(metrics) : timedOut ? false : null);

  // Latch the first decision so a later measurement never swaps the navigator.
  if (columns === null && decided !== null) setColumns(decided);

  return (
    <WindowMetricsContext value={metrics}>
      <LayoutMetricsObserver onChange={setMetrics} />
      {children({ ready: decided !== null, columns: decided === true })}
    </WindowMetricsContext>
  );
}

function columnsFor(metrics: NativeLayoutMetrics) {
  return (
    Platform.OS === 'ios' && supportsSplitColumns && (Platform.isPad || metrics.hasHinge === true)
  );
}

export function useWindowMetrics() {
  return use(WindowMetricsContext);
}

/** The innermost native measurement: the column when inside one, else the window. */
export function useNativeMetrics() {
  const column = use(ColumnMetricsContext);
  const window = use(WindowMetricsContext);

  return column ?? window;
}

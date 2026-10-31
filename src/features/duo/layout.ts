import { createContext, useContext } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

import { MaxContentWidth } from '@/constants/theme';

import { useNativeMetrics, type NativeLayoutMetrics } from './native-metrics';

/**
 * Layout model for iPhone Duo and other resizable windows. On iOS the size
 * class, the vertical system bar, and the fold come from UIKit through the
 * `duo-native` metrics view, measured for the native split column the reader
 * sits in. Where that view is unavailable (Android, web, Expo Go) the width
 * decides the size class and there is no fold.
 */

/** Fallback breakpoint between compact and regular width where UIKit traits are unavailable. */
export const RegularWidthBreakpoint = 600;

export type SizeClass = 'compact' | 'regular';

export type Rect = { x: number; y: number; width: number; height: number };

export type DivisionRegion = {
  /** Vertical hinge divides leading from trailing; horizontal divides top from bottom. */
  axis: 'vertical' | 'horizontal';
  /** Frame including margins, in the viewport's coordinate space. */
  frame: Rect;
  isActive: boolean;
};

/**
 * Where the system keeps the status bar and navigation controls. iPhone Duo
 * stacks them in a vertical bar on the trailing edge (leading in a left Split
 * View app) everywhere except the inner display in portrait.
 */
export type SystemBarEdge = 'top' | 'leading' | 'trailing';

/** Narrowest vertical bar the Duo reports; iPhones in landscape stay below it on at least one side. */
const VerticalBarMinimumInset = 60;

/** A viewport narrower than the window, such as the stack beside a JavaScript PXI pane. */
export type DuoViewport = {
  width: number;
  height: number;
  systemBarEdge: SystemBarEdge;
};

export const DuoViewportContext = createContext<DuoViewport | null>(null);

export type DuoLayout = DuoViewport & {
  horizontalSizeClass: SizeClass;
  isRegularWidth: boolean;
  isLandscape: boolean;
  /** The active fold, or null when the device is flat, closed, or has no hinge. */
  division: DivisionRegion | null;
};

/**
 * A vertical system bar shows up as a wide inset on one side only with no
 * status-bar inset on top. Notched iPhones in landscape inset both sides.
 */
export function systemBarEdgeFor(insets: EdgeInsets): SystemBarEdge {
  if (insets.top >= 20) return 'top';

  if (insets.right >= VerticalBarMinimumInset && insets.left < 20) return 'trailing';

  if (insets.left >= VerticalBarMinimumInset && insets.right < 20) return 'leading';

  return 'top';
}

/**
 * Safe-area insets that still apply inside a pane: each edge keeps the share
 * of the container's inset that the pane actually reaches.
 */
export function insetsForPane(
  insets: EdgeInsets,
  frame: Rect,
  container: { width: number; height: number },
): EdgeInsets {
  return {
    top: Math.max(0, insets.top - frame.y),
    left: Math.max(0, insets.left - frame.x),
    right: Math.max(0, insets.right - (container.width - frame.x - frame.width)),
    bottom: Math.max(0, insets.bottom - (container.height - frame.y - frame.height)),
  };
}

/**
 * The native title of a screen whose content already carries its own title.
 * Beside a vertical system bar an empty title lets the horizontal navigation
 * bar collapse, so the content starts at the top edge of the display.
 */
export function nativeHeaderTitle(edge: SystemBarEdge, title: string): string {
  return edge === 'top' ? title : '';
}

function barEdgeFrom(metrics: NativeLayoutMetrics): SystemBarEdge {
  switch (metrics.verticalBarEdge) {
    case 'right':
      return 'trailing';
    case 'left':
      return 'leading';
    default:
      return 'top';
  }
}

function divisionFrom(metrics: NativeLayoutMetrics): DivisionRegion | null {
  const region = metrics.reservedRegions.find((candidate) => candidate.kind === 'division');

  if (!region) return null;

  return {
    axis: region.height >= region.width ? 'vertical' : 'horizontal',
    frame: { x: region.x, y: region.y, width: region.width, height: region.height },
    isActive: true,
  };
}

export function useDuoLayout(): DuoLayout {
  const framed = useContext(DuoViewportContext);
  const native = useNativeMetrics();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();

  if (framed === null && native !== null) {
    const horizontalSizeClass = native.horizontalSizeClass;

    // The usable width: a split's inspector overlays the detail column and
    // shows up as a wide trailing safe-area inset, as does the vertical bar.
    return {
      width: native.width - native.safeArea.left - native.safeArea.right,
      height: native.height,
      systemBarEdge: barEdgeFrom(native),
      horizontalSizeClass,
      isRegularWidth: horizontalSizeClass === 'regular',
      isLandscape: native.width > native.height,
      division: divisionFrom(native),
    };
  }

  const viewport: DuoViewport = framed ?? {
    width: window.width,
    height: window.height,
    systemBarEdge: systemBarEdgeFor(insets),
  };

  const horizontalSizeClass: SizeClass =
    viewport.width >= RegularWidthBreakpoint ? 'regular' : 'compact';

  return {
    ...viewport,
    horizontalSizeClass,
    isRegularWidth: horizontalSizeClass === 'regular',
    isLandscape: viewport.width > viewport.height,
    division: null,
  };
}

/**
 * Horizontal padding and width for a centered content column that keeps its
 * padding on the safe side of a vertical system bar. The column grows by the
 * insets so the visible content stays centered in the safe area.
 */
export function useContentColumnStyle(padding: number) {
  const insets = useSafeAreaInsets();

  return {
    maxWidth: MaxContentWidth + insets.left + insets.right,
    paddingLeft: padding + insets.left,
    paddingRight: padding + insets.right,
  };
}

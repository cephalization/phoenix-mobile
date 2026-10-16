import { createContext, useContext } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

import { MaxContentWidth } from '@/constants/theme';

import { type DuoDisplay, type DuoPose, useDuoPreviewStore } from './preview-store';

/**
 * iPhone Duo layout model for Expo SDK 57, which has no fold, hinge, or
 * reserved-region binding. Size classes follow Apple's rule that the outer
 * display is compact width and the inner display is regular width in every
 * orientation; the fold is modeled as a division region that is active only
 * while partially folded, matching `reservedRegions(kind: .division)`.
 * On a real Duo built with the 27.1 SDK the hinge comes from `expo-hinge`
 * (SDK 58); until then the division region is supplied by the preview harness.
 */

/** Point sizes at 3x, portrait, from Apple's screenshot specifications. */
export const DuoPoints = {
  outer: { width: 466, height: 678 },
  inner: { width: 669, height: 951 },
} as const;

/** Community breakpoint between the outer (466 pt) and inner (669 pt) widths. */
export const RegularWidthBreakpoint = 600;

/** Clearance Apple asks for around the fold for interactive content; the exact value is unpublished. */
export const FoldMargin = 22;

export type SizeClass = 'compact' | 'regular';

export type Rect = { x: number; y: number; width: number; height: number };

export type DivisionRegion = {
  /** Vertical hinge divides leading from trailing; horizontal divides top from bottom. */
  axis: 'vertical' | 'horizontal';
  /** Frame including margins, in the viewport's coordinate space. */
  frame: Rect;
  margins: number;
  isActive: boolean;
};

/**
 * Where the system keeps the status bar and navigation controls. iPhone Duo
 * stacks them in a vertical bar on the trailing edge (leading in a left Split
 * View app) everywhere except the inner display in portrait, which keeps the
 * horizontal bars every other iPhone has.
 */
export type SystemBarEdge = 'top' | 'leading' | 'trailing';

/** Narrowest vertical bar the Duo reports; iPhones in landscape stay below it on at least one side. */
const VerticalBarMinimumInset = 60;

export type HingeState = {
  status: 'closed' | 'partiallyOpen' | 'fullyOpen';
  /** Degrees, 0 closed to 180 flat. */
  angle: number;
};

export type DuoViewport = {
  width: number;
  height: number;
  /** `preview` when the harness frames the app at Duo point sizes. */
  source: 'window' | 'preview';
  display: DuoDisplay | 'unknown';
  pose: DuoPose;
  hinge: HingeState | null;
  systemBarEdge: SystemBarEdge;
};

export const DuoViewportContext = createContext<DuoViewport | null>(null);

export type DuoLayout = DuoViewport & {
  horizontalSizeClass: SizeClass;
  verticalSizeClass: SizeClass;
  isRegularWidth: boolean;
  isLandscape: boolean;
  /** The fold, whether or not it is active; null on devices without one. */
  division: DivisionRegion | null;
  /** Usable regions either side of an active fold; a single region otherwise. */
  regions: Rect[];
};

export function divisionFor(viewport: DuoViewport): DivisionRegion | null {
  if (viewport.display !== 'inner') return null;
  const isActive = viewport.pose !== 'flat';
  const axis = viewport.pose === 'tabletop' ? 'horizontal' : 'vertical';
  const thickness = isActive ? FoldMargin * 2 : 0;

  const frame: Rect =
    axis === 'vertical'
      ? { x: viewport.width / 2 - thickness / 2, y: 0, width: thickness, height: viewport.height }
      : { x: 0, y: viewport.height / 2 - thickness / 2, width: viewport.width, height: thickness };

  return { axis, frame, margins: isActive ? FoldMargin : 0, isActive };
}

export function regionsFor(viewport: DuoViewport, division: DivisionRegion | null): Rect[] {
  const whole: Rect = { x: 0, y: 0, width: viewport.width, height: viewport.height };

  if (!division?.isActive) return [whole];

  if (division.axis === 'vertical') {
    const right = division.frame.x + division.frame.width;

    return [
      { x: 0, y: 0, width: division.frame.x, height: viewport.height },
      { x: right, y: 0, width: viewport.width - right, height: viewport.height },
    ];
  }

  const bottom = division.frame.y + division.frame.height;

  return [
    { x: 0, y: 0, width: viewport.width, height: division.frame.y },
    { x: 0, y: bottom, width: viewport.width, height: viewport.height - bottom },
  ];
}

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
 * With a vertical system bar an empty title lets the horizontal navigation bar
 * collapse, so the content starts at the top edge of the display.
 */
export function nativeHeaderTitle(edge: SystemBarEdge, title: string): string {
  return edge === 'top' ? title : '';
}

export function sizeClassesFor(width: number, height: number): [SizeClass, SizeClass] {
  const horizontal: SizeClass = width >= RegularWidthBreakpoint ? 'regular' : 'compact';

  // Apple: the inner display is regular/regular in both orientations; the outer
  // display is compact/compact in landscape, like other iPhones.
  const vertical: SizeClass =
    horizontal === 'regular' || height >= RegularWidthBreakpoint ? 'regular' : 'compact';

  return [horizontal, vertical];
}

export function useDuoLayout(): DuoLayout {
  const framed = useContext(DuoViewportContext);
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const viewport: DuoViewport = framed ?? {
    width: window.width,
    height: window.height,
    source: 'window',
    display: 'unknown',
    pose: 'flat',
    hinge: null,
    systemBarEdge: systemBarEdgeFor(insets),
  };

  const [horizontalSizeClass, verticalSizeClass] = sizeClassesFor(viewport.width, viewport.height);
  const division = divisionFor(viewport);

  return {
    ...viewport,
    horizontalSizeClass,
    verticalSizeClass,
    isRegularWidth: horizontalSizeClass === 'regular',
    isLandscape: viewport.width > viewport.height,
    division,
    regions: regionsFor(viewport, division),
  };
}

/** The preview harness reads the store; the layout hook reads only the context it provides. */
export function usePreviewViewport(): DuoViewport | null {
  const enabled = useDuoPreviewStore((state) => state.enabled);
  const display = useDuoPreviewStore((state) => state.display);
  const orientation = useDuoPreviewStore((state) => state.orientation);
  const pose = useDuoPreviewStore((state) => state.pose);
  const hingeAngle = useDuoPreviewStore((state) => state.hingeAngle);

  if (!enabled) return null;
  const points = DuoPoints[display];
  const portrait = orientation === 'portrait';

  return {
    width: portrait ? points.width : points.height,
    height: portrait ? points.height : points.width,
    source: 'preview',
    display,
    pose: display === 'outer' ? 'flat' : pose,
    hinge: {
      status: hingeAngle <= 5 ? 'closed' : hingeAngle >= 170 ? 'fullyOpen' : 'partiallyOpen',
      angle: hingeAngle,
    },
    systemBarEdge: display === 'inner' && portrait ? 'top' : 'trailing',
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

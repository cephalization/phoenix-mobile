import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { insetsForPane, useDuoLayout, type DivisionRegion } from '@/features/duo/layout';

/**
 * A JavaScript rendition of Apple's `ArrangementView` for screens that are not
 * in native split columns (Android, web, and wide windows without the native
 * split). It holds a primary and a secondary pane and lays them out from the
 * container size and the fold:
 *
 * - `split` places the panes side by side when the container is wider than
 *   tall and stacks them otherwise. While the device is partially folded the
 *   split snaps to 50/50 around the fold with the fold's margins as a gutter.
 * - `overlay` floats the primary over the secondary when the device is flat or
 *   closed, and moves the primary to the trailing or bottom region (the
 *   secondary to the leading or top) when the fold is active.
 *
 * Each pane republishes the safe-area insets that reach it, so a trailing
 * pane keeps the vertical system bar's inset while a leading pane does not.
 * The top inset is handed down only when `insetEdges` says the arrangement
 * touches the top of the window; screens under a native header leave it out.
 *
 * Keep navigation outside it and never put it inside a scroll view.
 */
export type ArrangementStyle = 'split' | 'overlay';

export type ArrangementAxes = 'horizontal' | 'vertical' | 'both';

export type ArrangementPane = {
  role: 'primary' | 'secondary';
  /** The split axis in effect, or null when the pane is overlaid or alone. */
  axis: 'horizontal' | 'vertical' | null;
  isFolded: boolean;
  /** The pane's planned frame in the arrangement's coordinate space. */
  frame: { x: number; y: number; width: number; height: number };
  /** The other pane's planned frame, or null while this pane is alone. */
  sibling: { x: number; y: number; width: number; height: number } | null;
};

const PaneContext = createContext<ArrangementPane | null>(null);

type InsetEdge = 'top' | 'left' | 'right' | 'bottom';

/** Screens under a native header do not reach the top of the window. */
const DefaultInsetEdges: InsetEdge[] = ['left', 'right', 'bottom'];

export function useArrangementPane(): ArrangementPane | null {
  return useContext(PaneContext);
}

type Frame = { x: number; y: number; width: number; height: number };

type Plan = {
  axis: 'horizontal' | 'vertical' | null;
  primary: Frame | null;
  secondary: Frame | null;
  primaryOnTop: boolean;
};

function planLayout({
  arrangement,
  axes,
  containerHeight,
  containerWidth,
  division,
  overlayFraction,
  preferredAxis,
  primaryVisible,
  ratio,
  secondaryVisible,
}: {
  arrangement: ArrangementStyle;
  axes: ArrangementAxes;
  containerHeight: number;
  containerWidth: number;
  division: DivisionRegion | null;
  overlayFraction: number;
  preferredAxis: 'horizontal' | 'vertical' | undefined;
  primaryVisible: boolean;
  ratio: number;
  secondaryVisible: boolean;
}): Plan {
  const whole: Frame = { x: 0, y: 0, width: containerWidth, height: containerHeight };

  if (!primaryVisible && secondaryVisible) {
    return { axis: null, primary: null, secondary: whole, primaryOnTop: false };
  }

  if (!secondaryVisible || containerWidth === 0 || containerHeight === 0) {
    return { axis: null, primary: whole, secondary: null, primaryOnTop: false };
  }

  const folded = division?.isActive === true;

  // Folded: the fold dictates the axis. Flat: `preferredAxis` wins (a side-by-side
  // list and detail on the portrait inner display), otherwise the container's
  // aspect ratio decides, like Apple's split arrangement.
  const naturalAxis: 'horizontal' | 'vertical' =
    folded && division
      ? division.axis === 'vertical'
        ? 'horizontal'
        : 'vertical'
      : (preferredAxis ?? (containerWidth > containerHeight ? 'horizontal' : 'vertical'));

  const axisAllowed = axes === 'both' || axes === naturalAxis;

  if (arrangement === 'overlay' && !folded) {
    // Flat or closed: primary floats over the secondary along the trailing or bottom edge.
    const horizontal = containerWidth > containerHeight;

    const primary: Frame = horizontal
      ? {
          x: containerWidth * (1 - overlayFraction),
          y: 0,
          width: containerWidth * overlayFraction,
          height: containerHeight,
        }
      : {
          x: 0,
          y: containerHeight * (1 - overlayFraction),
          width: containerWidth,
          height: containerHeight * overlayFraction,
        };

    return { axis: null, primary, secondary: whole, primaryOnTop: true };
  }

  if (!axisAllowed) {
    return { axis: null, primary: whole, secondary: null, primaryOnTop: false };
  }

  // Folded splits snap to 50/50 around the fold; flat splits honor the ratio.
  const gutter =
    folded && division
      ? division.axis === 'vertical'
        ? division.frame.width
        : division.frame.height
      : 0;

  const share = folded ? 0.5 : ratio;
  const primaryTrailing = arrangement === 'overlay';

  if (naturalAxis === 'horizontal') {
    const available = containerWidth - gutter;
    const first = Math.round(available * (primaryTrailing ? 1 - share : share));
    const second = available - first;
    const leading: Frame = { x: 0, y: 0, width: first, height: containerHeight };
    const trailing: Frame = { x: first + gutter, y: 0, width: second, height: containerHeight };

    return {
      axis: 'horizontal',
      primary: primaryTrailing ? trailing : leading,
      secondary: primaryTrailing ? leading : trailing,
      primaryOnTop: false,
    };
  }

  const available = containerHeight - gutter;
  const first = Math.round(available * (primaryTrailing ? 1 - share : share));
  const second = available - first;
  const top: Frame = { x: 0, y: 0, width: containerWidth, height: first };
  const bottom: Frame = { x: 0, y: first + gutter, width: containerWidth, height: second };

  return {
    axis: 'vertical',
    primary: primaryTrailing ? bottom : top,
    secondary: primaryTrailing ? top : bottom,
    primaryOnTop: false,
  };
}

export function DuoArrangement({
  arrangement = 'split',
  axes = 'both',
  insetEdges = DefaultInsetEdges,
  overlayFraction = 0.42,
  preferredAxis,
  primary,
  primaryVisible = true,
  ratio = 0.5,
  secondary,
  secondaryVisible = true,
}: {
  arrangement?: ArrangementStyle;
  /** Restrict the split axis; the primary is shown alone when the natural axis is disallowed. */
  axes?: ArrangementAxes;
  /** Window edges the arrangement reaches, whose safe-area insets the panes inherit. */
  insetEdges?: InsetEdge[];
  /** Share of the container the floating primary takes in an overlay while flat. */
  overlayFraction?: number;
  /** Split axis to use while flat; an active fold still decides the axis when folded. */
  preferredAxis?: 'horizontal' | 'vertical';
  primary: ReactNode;
  /** Collapse the primary so the secondary fills the container; the primary wins when both collapse. */
  primaryVisible?: boolean;
  /** Primary share of a flat split, 0 to 1. */
  ratio?: number;
  secondary: ReactNode;
  /** Collapse the secondary so the primary fills the container. */
  secondaryVisible?: boolean;
}) {
  const { division } = useDuoLayout();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [size, setSize] = useState({ width: 0, height: 0 });

  const plan = planLayout({
    arrangement,
    axes,
    containerHeight: size.height,
    containerWidth: size.width,
    division,
    overlayFraction,
    preferredAxis,
    primaryVisible,
    ratio,
    secondaryVisible,
  });

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;

    setSize((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  };

  const folded = division?.isActive === true;
  const axis = plan.axis;

  const whole: Frame = { x: 0, y: 0, width: size.width, height: size.height };
  const primaryFrame = plan.primary ?? plan.secondary ?? whole;
  const secondaryFrame = plan.secondary ?? primaryFrame;
  const primaryShown = plan.primary;
  const secondaryShown = plan.secondary;

  const primaryPane = useMemo<ArrangementPane>(
    () => ({
      role: 'primary',
      axis,
      isFolded: folded,
      frame: primaryFrame,
      sibling: secondaryShown,
    }),
    [axis, folded, primaryFrame, secondaryShown],
  );

  const secondaryPane = useMemo<ArrangementPane>(
    () => ({
      role: 'secondary',
      axis,
      isFolded: folded,
      frame: secondaryFrame,
      sibling: secondaryShown ? primaryShown : null,
    }),
    [axis, folded, primaryShown, secondaryFrame, secondaryShown],
  );

  const reachable = {
    top: insetEdges.includes('top') ? insets.top : 0,
    left: insetEdges.includes('left') ? insets.left : 0,
    right: insetEdges.includes('right') ? insets.right : 0,
    bottom: insetEdges.includes('bottom') ? insets.bottom : 0,
  };

  const primaryInsets = insetsForPane(reachable, primaryFrame, size);
  const secondaryInsets = insetsForPane(reachable, secondaryFrame, size);

  return (
    <View onLayout={handleLayout} style={styles.container}>
      {plan.secondary ? (
        <AnimatedPane frame={plan.secondary} reduceMotion={reduceMotion} zIndex={0}>
          <PaneContext.Provider value={secondaryPane}>
            <SafeAreaInsetsContext.Provider value={secondaryInsets}>
              {secondary}
            </SafeAreaInsetsContext.Provider>
          </PaneContext.Provider>
        </AnimatedPane>
      ) : null}
      {plan.primary ? (
        <AnimatedPane
          elevated={plan.primaryOnTop}
          frame={plan.primary}
          reduceMotion={reduceMotion}
          zIndex={1}
        >
          <PaneContext.Provider value={primaryPane}>
            <SafeAreaInsetsContext.Provider value={primaryInsets}>
              {primary}
            </SafeAreaInsetsContext.Provider>
          </PaneContext.Provider>
        </AnimatedPane>
      ) : null}
    </View>
  );
}

const FOLD_TIMING = { duration: 320, easing: Easing.out(Easing.cubic) };

function AnimatedPane({
  children,
  elevated = false,
  frame,
  reduceMotion,
  zIndex,
}: {
  children: ReactNode;
  elevated?: boolean;
  frame: Frame;
  reduceMotion: boolean;
  zIndex: number;
}) {
  const x = useSharedValue(frame.x);
  const y = useSharedValue(frame.y);
  const width = useSharedValue(frame.width);
  const height = useSharedValue(frame.height);

  // Frames settle to their targets; the fold transition is the only motion. The
  // first measurement snaps so panes do not grow from nothing on mount.
  useEffect(() => {
    const firstLayout = width.value === 0 || height.value === 0;

    const targets: [{ value: number }, number][] = [
      [x, frame.x],
      [y, frame.y],
      [width, frame.width],
      [height, frame.height],
    ];

    for (const [value, target] of targets) {
      value.value = reduceMotion || firstLayout ? target : withTiming(target, FOLD_TIMING);
    }
  }, [frame.height, frame.width, frame.x, frame.y, height, reduceMotion, width, x, y]);

  const animatedStyle = useAnimatedStyle(() => ({
    left: x.value,
    top: y.value,
    width: width.value,
    height: height.value,
  }));

  return (
    <Animated.View
      style={[styles.pane, animatedStyle, { zIndex }, elevated ? styles.elevated : null]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  // Panes are containers: touches fall through to their children or to the pane beneath.
  pane: { overflow: 'hidden', pointerEvents: 'box-none', position: 'absolute' },
  elevated: {
    shadowColor: '#000000',
    shadowOffset: { height: -4, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
  },
});

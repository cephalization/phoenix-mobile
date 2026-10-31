import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

/** Where iOS 27 places a form sheet within the presenting window. */
export type SheetPlacement = 'automatic' | 'leading' | 'center' | 'trailing';

/** An area of a view that the system reserves: the fold (division) or a camera (occlusion). */
export type ReservedRegion = {
  kind: 'division' | 'occlusion';
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Geometry UIKit reports for a view, in that view's coordinate space. */
export type NativeLayoutMetrics = {
  width: number;
  height: number;
  /** Whether the device has a hinge, such as iPhone Duo. */
  hasHinge: boolean;
  horizontalSizeClass: 'compact' | 'regular';
  /** The physical edge of iPhone Duo's vertical system bar, or `none` for horizontal bars. */
  verticalBarEdge: 'none' | 'left' | 'right';
  safeArea: { top: number; bottom: number; left: number; right: number };
  /** Active reserved regions that intersect the view. */
  reservedRegions: ReservedRegion[];
};

type DuoNativeModule = {
  supportsSplitColumns?: boolean;
  setPreferredPlacement: (placement: SheetPlacement) => void;
};

type LayoutMetricsViewProps = ViewProps & {
  onMetricsChange?: (event: NativeSyntheticEvent<NativeLayoutMetrics>) => void;
};

const nativeModule = requireOptionalNativeModule<DuoNativeModule>('DuoNative');

/** Whether this binary carries the react-native-screens v5 split host. */
export const supportsSplitColumns = nativeModule?.supportsSplitColumns === true;

/**
 * The native metrics view, or null in Expo Go, on Android, and on web. It
 * reports its own frame, so place it where the geometry should be measured.
 */
export const LayoutMetricsView: ComponentType<LayoutMetricsViewProps> | null =
  nativeModule === null ? null : requireNativeView<LayoutMetricsViewProps>('DuoNative');

/**
 * Chooses the placement for every form sheet presented from now on. iOS 27
 * docks a form sheet to the leading edge of a wide window by default; iPhone
 * Duo's inner display reads better with sheets beside the vertical system bar
 * on the trailing edge. A no-op on platforms without the native module.
 */
export function setSheetPlacement(placement: SheetPlacement) {
  nativeModule?.setPreferredPlacement(placement);
}

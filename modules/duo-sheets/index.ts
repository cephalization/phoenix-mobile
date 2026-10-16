import { requireOptionalNativeModule } from 'expo-modules-core';

/** Where iOS 27 places a form sheet within the presenting window. */
export type SheetPlacement = 'automatic' | 'leading' | 'center' | 'trailing';

type DuoSheetsNativeModule = {
  setPreferredPlacement: (placement: SheetPlacement) => void;
};

const nativeModule = requireOptionalNativeModule<DuoSheetsNativeModule>('DuoSheets');

/**
 * Chooses the placement for every form sheet presented from now on. iOS 27
 * docks a form sheet to the leading edge of a wide window by default; iPhone
 * Duo's inner display reads better with sheets beside the vertical system bar
 * on the trailing edge. A no-op on platforms without the native module.
 */
export function setSheetPlacement(placement: SheetPlacement) {
  nativeModule?.setPreferredPlacement(placement);
}

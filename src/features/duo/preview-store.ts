import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export type DuoDisplay = 'outer' | 'inner';

export type DuoOrientation = 'portrait' | 'landscape';

/** Flat is fully open; book folds on a vertical hinge; tabletop on a horizontal one. */
export type DuoPose = 'flat' | 'book' | 'tabletop';

type DuoPreviewState = {
  /** Frame the app at iPhone Duo point sizes on whatever simulator is running. */
  enabled: boolean;
  display: DuoDisplay;
  orientation: DuoOrientation;
  pose: DuoPose;
  /** Hinge angle in degrees, 0 closed to 180 flat. */
  hingeAngle: number;
  /** A route the preview frame opens once on launch, for demos and scripted runs. */
  launchRoute: string | null;
  setEnabled: (enabled: boolean) => void;
  setLaunchRoute: (launchRoute: string | null) => void;
  setDisplay: (display: DuoDisplay) => void;
  setOrientation: (orientation: DuoOrientation) => void;
  setPose: (pose: DuoPose) => void;
  setHingeAngle: (hingeAngle: number) => void;
};

const serverStorage: StateStorage = {
  getItem: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
};

const storage = createJSONStorage(() =>
  Platform.OS === 'web' && typeof window === 'undefined' ? serverStorage : AsyncStorage,
);

export const useDuoPreviewStore = create<DuoPreviewState>()(
  persist(
    (set) => ({
      enabled: false,
      display: 'inner',
      orientation: 'portrait',
      pose: 'flat',
      hingeAngle: 180,
      launchRoute: null,
      setEnabled: (enabled) => set({ enabled }),
      setLaunchRoute: (launchRoute) => set({ launchRoute }),
      setDisplay: (display) =>
        // The outer display only exists closed, so it has no fold to preview.
        set(display === 'outer' ? { display, pose: 'flat', hingeAngle: 0 } : { display }),
      setOrientation: (orientation) => set({ orientation }),
      setPose: (pose) =>
        set({
          pose,
          hingeAngle: pose === 'flat' ? 180 : 120,
        }),
      setHingeAngle: (hingeAngle) => {
        const clamped = Math.min(180, Math.max(0, Math.round(hingeAngle)));

        set((state) => ({
          hingeAngle: clamped,
          pose: clamped >= 170 ? 'flat' : state.pose === 'flat' ? 'book' : state.pose,
        }));
      },
    }),
    { name: 'phoenix-duo-preview', storage },
  ),
);

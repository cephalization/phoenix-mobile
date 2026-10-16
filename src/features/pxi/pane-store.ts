import { create } from 'zustand';

/**
 * The PXI companion: on a regular-width window (the iPhone Duo's inner
 * display, an iPad, a wide web window) the PXI chat opens in a column beside
 * the navigation stack instead of pushing the chat route. The shell publishes
 * whether the column is available; the header button decides between the
 * column and the route. Only the chat lives here: contextual actions such as
 * Investigate are tasks and always present as sheets.
 */
type PxiPaneState = {
  available: boolean;
  /** Instance whose PXI fills the column, or null while it is closed. */
  instanceId: string | null;
  /**
   * Padding content screens add so their layout stops where the PXI column
   * begins; the native stack itself keeps the whole window.
   */
  stackContentInset: { right: number; bottom: number };
  setAvailable: (available: boolean) => void;
  setStackContentInset: (inset: { right: number; bottom: number }) => void;
  open: (instanceId: string) => void;
  close: () => void;
};

export const usePxiPaneStore = create<PxiPaneState>()((set) => ({
  available: false,
  instanceId: null,
  stackContentInset: { right: 0, bottom: 0 },
  setAvailable: (available) => set({ available }),
  setStackContentInset: (stackContentInset) =>
    set((state) =>
      state.stackContentInset.right === stackContentInset.right &&
      state.stackContentInset.bottom === stackContentInset.bottom
        ? state
        : { stackContentInset },
    ),
  open: (instanceId) => set({ instanceId }),
  close: () => set({ instanceId: null }),
}));

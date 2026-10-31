import { useEffect, useMemo, type ReactNode } from 'react';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { PxiChat } from '@/components/chat/pxi-chat';
import { DuoViewportContext, useDuoLayout, type DuoViewport } from '@/features/duo/layout';
import { usePxiPaneStore } from '@/features/pxi/pane-store';
import { useInstanceStore } from '@/store/instances';

import { DuoArrangement, useArrangementPane } from './arrangement';

/**
 * Share of the window the PXI column takes. It matches the column a trailing
 * form sheet fills on the open iPhone Duo (measured: the sheet's leading edge
 * sits at 310 pt of the 951 pt window), so every surface that docks beside
 * the vertical bar shares one leading edge.
 */
const PxiShare = (951 - 310) / 951;

/**
 * Hosts the navigation stack under a window-level overlay arrangement whose
 * floating pane is PXI. The native stack keeps the whole window, which is
 * what keeps iPhone Duo's vertical bar (Back and the PXI item) at the window
 * edge and responsive: UIKit draws that bar for a narrower navigation
 * controller too, but then stops delivering touches to it. Screens pad their
 * content away from the pane and read the remaining size as their viewport,
 * so they behave like single screens while PXI is open.
 */
export function PxiPaneShell({ children }: { children: ReactNode }) {
  const layout = useDuoLayout();
  const instanceId = usePxiPaneStore((state) => state.instanceId);
  const setAvailable = usePxiPaneStore((state) => state.setAvailable);
  const close = usePxiPaneStore((state) => state.close);

  const instance = useInstanceStore((state) =>
    state.instances.find((candidate) => candidate.id === instanceId),
  );

  const available = layout.isRegularWidth;
  const open = available && instance !== undefined;

  // A window that narrows below regular width (the Duo closing) drops the pane;
  // the header button then opens the chat route instead.
  useEffect(() => {
    setAvailable(available);

    if (!available) close();
  }, [available, close, setAvailable]);

  const viewport: DuoViewport = {
    width: layout.width,
    height: layout.height,
    systemBarEdge: layout.systemBarEdge,
  };

  return (
    <DuoArrangement
      arrangement="overlay"
      insetEdges={['top', 'left', 'right', 'bottom']}
      overlayFraction={PxiShare}
      primary={
        <PaneViewport open={open} window={viewport}>
          {instance ? <PxiChat instance={instance} onClose={close} presentation="pane" /> : null}
        </PaneViewport>
      }
      primaryVisible={open}
      secondary={
        <StackViewport open={open} window={viewport}>
          {children}
        </StackViewport>
      }
    />
  );
}

/**
 * The stack's viewport is the part of its pane the floating PXI pane leaves
 * uncovered. Its size goes to `useDuoLayout` for the screens inside, its
 * safe-area insets are clipped to it, and its padding goes to the store for
 * the stack's content style.
 */
function StackViewport({
  children,
  open,
  window,
}: {
  children: ReactNode;
  open: boolean;
  window: DuoViewport;
}) {
  const pane = useArrangementPane();
  const paneInsets = useSafeAreaInsets();
  const setStackContentInset = usePxiPaneStore((state) => state.setStackContentInset);

  const frame = pane?.frame ?? null;
  const sibling = open ? (pane?.sibling ?? null) : null;

  const coveredRight =
    frame && sibling && sibling.x > frame.x ? Math.max(0, frame.x + frame.width - sibling.x) : 0;

  const coveredBottom =
    frame && sibling && sibling.y > frame.y ? Math.max(0, frame.y + frame.height - sibling.y) : 0;

  useEffect(() => {
    setStackContentInset({ right: coveredRight, bottom: coveredBottom });
  }, [coveredBottom, coveredRight, setStackContentInset]);

  const viewport = useMemo<DuoViewport>(
    () =>
      open && frame !== null && frame.width > 0
        ? {
            ...window,
            width: frame.width - coveredRight,
            height: frame.height - coveredBottom,
          }
        : window,
    [coveredBottom, coveredRight, frame, open, window],
  );

  const insets = useMemo(
    () => ({
      ...paneInsets,
      right: Math.max(0, paneInsets.right - coveredRight),
      bottom: Math.max(0, paneInsets.bottom - coveredBottom),
    }),
    [coveredBottom, coveredRight, paneInsets],
  );

  return (
    <DuoViewportContext.Provider value={viewport}>
      <SafeAreaInsetsContext.Provider value={insets}>{children}</SafeAreaInsetsContext.Provider>
    </DuoViewportContext.Provider>
  );
}

/**
 * Publishes the floating pane's own size as the viewport for the chat inside
 * it. The fold never runs through a pane (a folded arrangement snaps around
 * it), so panes carry no division of their own.
 */
function PaneViewport({
  children,
  open,
  window,
}: {
  children: ReactNode;
  open: boolean;
  window: DuoViewport;
}) {
  const pane = useArrangementPane();
  const paneWidth = pane?.frame.width ?? 0;
  const paneHeight = pane?.frame.height ?? 0;

  const viewport = useMemo<DuoViewport>(
    () => (open && paneWidth > 0 ? { ...window, width: paneWidth, height: paneHeight } : window),
    [open, paneHeight, paneWidth, window],
  );

  return <DuoViewportContext.Provider value={viewport}>{children}</DuoViewportContext.Provider>;
}

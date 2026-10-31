import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { PxiChat } from '@/components/chat/pxi-chat';
import { useAppColors } from '@/constants/theme';
import type { PhoenixInstance } from '@/types/instance';

/** Gap between the panel and the window's safe edges. */
const PanelInset = 10;

const NoInsets = { bottom: 0, left: 0, right: 0, top: 0 };

const SlideTiming = { duration: 280, easing: Easing.out(Easing.cubic) };

/**
 * PXI as a floating panel that slides in from the trailing edge over the split
 * columns, beside iPhone Duo's vertical bar, when the window has room for it.
 * The columns keep their layout underneath. The panel stays mounted until it
 * has slid out, and appears without motion when Reduce Motion is on.
 */
export function PxiFloatingPanel({
  instance,
  onClose,
}: {
  instance: PhoenixInstance | undefined;
  onClose: () => void;
}) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(instance);
  const progress = useSharedValue(0);

  // Keep the last instance on screen while the panel slides out.
  if (instance !== undefined && instance !== shown) setShown(instance);

  const width = Math.min(420, Math.max(340, window.width * 0.42));
  const travel = width + insets.right + PanelInset * 2;
  const open = instance !== undefined;

  useEffect(() => {
    if (open) {
      progress.value = reduceMotion ? 1 : withTiming(1, SlideTiming);

      return;
    }

    const hide = () => setShown(undefined);

    if (reduceMotion) {
      progress.value = 0;
      hide();

      return;
    }

    progress.value = withTiming(0, SlideTiming, (finished) => {
      if (finished) scheduleOnRN(hide);
    });
  }, [open, progress, reduceMotion]);

  const slide = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - progress.value) * travel }],
  }));

  if (shown === undefined) return null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          styles.panel,
          {
            bottom: insets.bottom + PanelInset,
            right: insets.right + PanelInset,
            top: insets.top + PanelInset,
            width,
          },
          slide,
        ]}
      >
        {/* The shadow lives on the outer view; clipping it would clip the shadow.
            The panel is the one raised surface, so it keeps a soft lift. */}
        <View
          style={[
            styles.surface,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          {/* The panel already sits inside the safe area and beside the vertical bar. */}
          <SafeAreaInsetsContext.Provider value={NoInsets}>
            <PxiChat instance={shown} onClose={onClose} presentation="pane" />
          </SafeAreaInsetsContext.Provider>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: 26,
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.14,
    shadowRadius: 22,
  },
  surface: {
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    overflow: 'hidden',
  },
});

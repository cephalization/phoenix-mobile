import type { ReactNode, RefObject } from 'react';
import { createContext, use, useRef } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';

import { AppFonts, useAppColors } from '@/constants/theme';
import { haptics } from '@/lib/haptics';

const ActionWidth = 88;

const SwipingContext = createContext<RefObject<boolean>>({ current: false });

/**
 * A ref that is true while the enclosing `SwipeActionRow` is dragged or settling.
 * A row's press checks it: lifting a finger after a swipe would otherwise
 * also count as a tap, because in a native form sheet the swipe cannot
 * cancel React Native's touch responder.
 */
export function useSwipingRef() {
  return use(SwipingContext);
}

/**
 * A row that slides left to reveal one destructive action, as in Mail and
 * Settings. `onAction` receives `close`, so a confirmation that is cancelled
 * can slide the row back. The row itself should also offer the action to
 * assistive technologies, which cannot swipe.
 */
export function SwipeActionRow({
  actionLabel,
  children,
  onAction,
}: {
  actionLabel: string;
  children: ReactNode;
  onAction: (close: () => void) => void;
}) {
  const colors = useAppColors();
  const swipeable = useRef<SwipeableMethods>(null);
  // Set when a drag starts and cleared once the row settles open or closed,
  // which is after the release that ends the drag.
  const swiping = useRef(false);
  const close = () => swipeable.current?.close();

  const startSwipe = () => {
    swiping.current = true;
  };

  const endSwipe = () => {
    swiping.current = false;
  };

  return (
    <Swipeable
      childrenContainerStyle={{ backgroundColor: colors.background }}
      friction={1.6}
      onSwipeableClose={endSwipe}
      onSwipeableCloseStartDrag={startSwipe}
      onSwipeableOpen={endSwipe}
      onSwipeableOpenStartDrag={startSwipe}
      onSwipeableWillOpen={haptics.selection}
      overshootRight={false}
      ref={swipeable}
      renderRightActions={(progress) => (
        <RevealedAction
          label={actionLabel}
          onPress={() => {
            haptics.warning();
            onAction(close);
          }}
          progress={progress}
        />
      )}
      rightThreshold={ActionWidth / 2}
    >
      <SwipingContext value={swiping}>{children}</SwipingContext>
    </Swipeable>
  );
}

function RevealedAction({
  label,
  onPress,
  progress,
}: {
  label: string;
  onPress: () => void;
  progress: SharedValue<number>;
}) {
  const colors = useAppColors();

  // The label fades in as the row slides, so a short drag does not flash it.
  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.6, 1], [0, 0.4, 1], Extrapolation.CLAMP),
  }));

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.action, { backgroundColor: colors.danger }]}
    >
      <Animated.View style={labelStyle}>
        <Text numberOfLines={1} style={styles.label}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: 'center', justifyContent: 'center', width: ActionWidth },
  label: { color: '#FFFFFF', fontFamily: AppFonts.semibold, fontSize: 15 },
});

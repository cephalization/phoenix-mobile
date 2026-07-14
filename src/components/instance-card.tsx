import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { AppFonts, Spacing, useAppColors } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';
import type { PhoenixInstance } from '@/types/instance';

import { MotionPressable } from './motion-pressable';

type InstanceCardProps = {
  index: number;
  instance: PhoenixInstance;
  onRemove: (instance: PhoenixInstance) => void;
};

export function InstanceCard({ index, instance, onRemove }: InstanceCardProps) {
  const colors = useAppColors();
  const reduceMotion = useReducedMotion();
  const entrance = useSharedValue(reduceMotion ? 1 : 0);
  const setActiveInstanceId = useInstanceStore((state) => state.setActiveInstanceId);

  useEffect(() => {
    entrance.set(
      withDelay(
        Math.min(index, 6) * 45,
        withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) })
      )
    );
  }, [entrance, index]);

  const entranceStyle = useAnimatedStyle(() => ({
    opacity: entrance.get(),
    transform: [{ translateY: (1 - entrance.get()) * 10 }],
  }));

  return (
    <Animated.View style={entranceStyle}>
      <Swipeable
        childrenContainerStyle={{ backgroundColor: colors.backgroundElement }}
        friction={1.6}
        onSwipeableWillOpen={haptics.selection}
        overshootRight={false}
        rightThreshold={42}
        renderRightActions={(progress, _translation, methods) => (
          <RemoveAction
            close={methods.close}
            onRemove={() => onRemove(instance)}
            progress={progress}
          />
        )}>
        <MotionPressable
          accessibilityHint="Opens this Phoenix instance"
          accessibilityRole="button"
          onPress={() => {
            setActiveInstanceId(instance.id);
            router.push({ pathname: '/instances/[id]', params: { id: instance.id } });
          }}
          scaleTo={0.99}
          style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
          <View style={[styles.monogram, { backgroundColor: colors.accentSoft }]}>
            <Text style={[styles.monogramText, { color: colors.brand }]}>{instance.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.content}>
            <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
              {instance.name}
            </Text>
            <View style={styles.hostRow}>
              <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
              <Text numberOfLines={1} style={[styles.host, { color: colors.textSecondary }]}>
                {instance.baseUrl}
              </Text>
            </View>
          </View>
          <Text style={[styles.arrow, { color: colors.textSecondary }]}>›</Text>
        </MotionPressable>
      </Swipeable>
    </Animated.View>
  );
}

function RemoveAction({
  close,
  onRemove,
  progress,
}: {
  close: () => void;
  onRemove: () => void;
  progress: SharedValue<number>;
}) {
  const colors = useAppColors();
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.5, 1], [0, 0.6, 1], Extrapolation.CLAMP),
    transform: [{ translateX: interpolate(progress.value, [0, 1], [32, 0], Extrapolation.CLAMP) }],
  }));

  return (
    <Animated.View style={[styles.removeAction, { backgroundColor: colors.danger }, animatedStyle]}>
      <MotionPressable
        accessibilityLabel="Remove connection"
        accessibilityRole="button"
        haptic="warning"
        onPress={() => {
          close();
          onRemove();
        }}
        scaleTo={0.94}
        style={styles.removeActionButton}>
        <Text style={styles.removeActionText}>Remove</Text>
      </MotionPressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.three,
    minHeight: 76,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  monogram: { alignItems: 'center', borderRadius: 12, height: 46, justifyContent: 'center', width: 46 },
  monogramText: { fontFamily: AppFonts.semibold, fontSize: 17 },
  statusDot: { borderRadius: 5, height: 10, width: 10 },
  content: { flex: 1, gap: Spacing.one },
  hostRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  name: { fontFamily: AppFonts.semibold, fontSize: 16 },
  host: { flex: 1, fontFamily: AppFonts.regular, fontSize: 13 },
  arrow: { fontFamily: AppFonts.regular, fontSize: 27 },
  removeAction: { width: 92 },
  removeActionButton: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 12 },
  removeActionText: { color: '#FFFFFF', fontFamily: AppFonts.semibold, fontSize: 13 },
});

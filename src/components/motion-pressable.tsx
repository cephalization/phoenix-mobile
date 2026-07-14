import type { PressableProps, StyleProp, ViewStyle } from 'react-native';
import { Pressable } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { pressSpring } from '@/constants/motion';
import { haptics } from '@/lib/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type MotionPressableProps = Omit<PressableProps, 'style'> & {
  haptic?: 'light' | 'selection' | 'warning' | 'none';
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
};

export function MotionPressable({
  haptic = 'light',
  onPress,
  onPressIn,
  onPressOut,
  scaleTo = 0.975,
  style,
  ...props
}: MotionPressableProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <AnimatedPressable
      {...props}
      onPress={(event) => {
        if (haptic === 'light') haptics.light();
        if (haptic === 'selection') haptics.selection();
        if (haptic === 'warning') haptics.warning();
        onPress?.(event);
      }}
      onPressIn={(event) => {
        if (!reduceMotion) scale.set(withSpring(scaleTo, pressSpring));
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        if (!reduceMotion) scale.set(withSpring(1, pressSpring));
        onPressOut?.(event);
      }}
      style={[style, animatedStyle]}
    />
  );
}

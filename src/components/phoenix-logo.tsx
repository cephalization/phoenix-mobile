import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const phoenixLogo = require('@/assets/images/phoenix-logo.png');

export function PhoenixLogo({ loading = false, size = 28 }: { loading?: boolean; size?: number }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(progress);
    if (loading && !reduceMotion) {
      progress.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
    } else {
      progress.value = withTiming(0, { duration: 180 });
    }
  }, [loading, progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value * 0.18,
    transform: [{ translateY: progress.value * -2 }, { scale: 1 + progress.value * 0.035 }],
  }));

  return (
    <View accessibilityElementsHidden style={[styles.container, { height: size, width: size }]}>
      <Animated.View style={[styles.image, animatedStyle]}>
        <Image contentFit="contain" source={phoenixLogo} style={styles.image} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
  image: { height: '100%', width: '100%' },
});

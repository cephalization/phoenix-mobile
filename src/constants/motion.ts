import { Easing, FadeInDown, LinearTransition, ReduceMotion } from 'react-native-reanimated';

export const pressSpring = {
  damping: 18,
  mass: 0.55,
  stiffness: 380,
} as const;

export const listLayout = LinearTransition.duration(220)
  .easing(Easing.out(Easing.cubic))
  .reduceMotion(ReduceMotion.System);

export function listItemEntering(index: number) {
  return FadeInDown.delay(Math.min(index, 6) * 45)
    .duration(260)
    .withInitialValues({ opacity: 0, translateY: 10 })
    .reduceMotion(ReduceMotion.System);
}

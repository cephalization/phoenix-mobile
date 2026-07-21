import { router } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';

import { useAppColors } from '@/constants/theme';
import type { PhoenixInstance } from '@/types/instance';

import { MotionPressable } from './motion-pressable';
import { PxiGlyph } from './pxi-glyph';

export function PxiHeaderButton({ instance }: { instance: PhoenixInstance }) {
  const colors = useAppColors();

  return (
    <MotionPressable
      accessibilityLabel={`Open PXI for ${instance.name}`}
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/instances/[id]/chat', params: { id: instance.id } })}
      scaleTo={0.92}
      style={Platform.OS === 'ios'
        ? [styles.button, styles.iosButton]
        : [
            styles.button,
            styles.fallbackButton,
            {
              backgroundColor: colors.accent,
              borderColor: colors.background,
            },
          ]}>
      <PxiGlyph color={Platform.OS === 'ios' ? colors.text : colors.accentForeground} size={20} />
    </MotionPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackButton: {
    borderRadius: 16,
    borderWidth: 2,
    height: 48,
    width: 48,
  },
  iosButton: { height: 32, width: 32 },
});

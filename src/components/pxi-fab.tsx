import { router, usePathname } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppColors } from '@/constants/theme';
import { useInstanceStore } from '@/store/instances';

import { MotionPressable } from './motion-pressable';
import { PxiGlyph } from './pxi-glyph';

export function PxiFab() {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const hasHydrated = useInstanceStore((state) => state.hasHydrated);
  const activeInstanceId = useInstanceStore((state) => state.activeInstanceId);
  const instance = useInstanceStore((state) =>
    state.instances.find((candidate) => candidate.id === state.activeInstanceId)
  );
  const isChatRoute = /^\/instances\/[^/]+\/chat\/?$/.test(pathname);

  if (!hasHydrated || !activeInstanceId || !instance || isChatRoute) return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]}>
      <MotionPressable
        accessibilityLabel={`Open PXI for ${instance.name}`}
        accessibilityRole="button"
        haptic="selection"
        onPress={() =>
          router.push({ pathname: '/instances/[id]/chat', params: { id: activeInstanceId } })
        }
        scaleTo={0.92}
        style={[
          styles.fab,
          styles.fabShadow,
          {
            backgroundColor: colors.accent,
            borderColor: colors.background,
            top: insets.top + 12,
          },
        ]}>
        <PxiGlyph color={colors.accentForeground} size={22} />
      </MotionPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 3,
    height: 52,
    justifyContent: 'center',
    position: 'absolute',
    right: 16,
    width: 52,
    zIndex: 100,
  },
  fabShadow: Platform.select({
    android: { elevation: 8 },
    default: { boxShadow: '0 5px 12px rgba(0, 0, 0, 0.18)' },
  }),
  overlay: { pointerEvents: 'box-none' },
});

import { BottomSheet, RNHostView, type SnapPoint } from '@expo/ui';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MotionPressable } from '@/components/motion-pressable';
import { AppFonts, Spacing, useAppColors } from '@/constants/theme';

export function ChatBottomSheet({
  children,
  onClose,
  snapPoints = ['half', 'full'],
  subtitle,
  title,
  visible,
}: {
  children: ReactNode;
  onClose: () => void;
  snapPoints?: SnapPoint[];
  subtitle: string;
  title: string;
  visible: boolean;
}) {
  const colors = useAppColors();

  return (
    <BottomSheet
      isPresented={visible}
      onDismiss={onClose}
      showDragIndicator
      snapPoints={snapPoints}>
      <RNHostView>
        <View style={styles.sheet}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.headingGroup}>
              <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
              <Text numberOfLines={1} style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
            </View>
            <MotionPressable
              accessibilityLabel={`Close ${title.toLowerCase()}`}
              accessibilityRole="button"
              haptic="selection"
              onPress={onClose}
              style={[styles.closeButton, { backgroundColor: colors.backgroundSelected }]}>
              <SymbolView
                name={{ ios: 'xmark', android: 'close', web: 'close' }}
                size={17}
                tintColor={colors.text}
                weight="medium"
              />
            </MotionPressable>
          </View>
          <View style={styles.body}>{children}</View>
        </View>
      </RNHostView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing.three,
    minHeight: 68,
    paddingBottom: 12,
    paddingHorizontal: 4,
  },
  headingGroup: { flex: 1, gap: 2, minWidth: 0 },
  title: { fontFamily: AppFonts.semibold, fontSize: 21, letterSpacing: -0.35 },
  subtitle: { fontFamily: AppFonts.regular, fontSize: 12 },
  closeButton: { alignItems: 'center', borderRadius: 16, height: 44, justifyContent: 'center', width: 44 },
  body: { flex: 1 },
});

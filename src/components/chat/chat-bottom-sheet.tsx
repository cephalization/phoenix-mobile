import { BottomSheet, RNHostView, type SnapPoint } from '@expo/ui';
import { presentationBackground } from '@expo/ui/swift-ui/modifiers';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { AppFonts, useAppColors } from '@/constants/theme';

export function ChatBottomSheet({
  children,
  onClose,
  snapPoints = [{ fraction: 0.58 }, { fraction: 0.88 }],
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
      modifiers={Platform.OS === 'ios' ? [presentationBackground(colors.background)] : undefined}
      onDismiss={onClose}
      showDragIndicator
      snapPoints={snapPoints}>
      <RNHostView>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headingGroup}>
              <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
              <Text numberOfLines={1} style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
            </View>
          </View>
          <View style={styles.body}>{children}</View>
        </View>
      </RNHostView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingBottom: 20, paddingHorizontal: 20 },
  header: {
    justifyContent: 'center',
    minHeight: 72,
    paddingBottom: 14,
    paddingTop: 4,
  },
  headingGroup: { gap: 4, minWidth: 0 },
  title: { fontFamily: AppFonts.semibold, fontSize: 20, letterSpacing: -0.3 },
  subtitle: { fontFamily: AppFonts.regular, fontSize: 13, lineHeight: 18 },
  body: { flex: 1 },
});

import { BottomSheet, RNHostView, type SnapPoint } from '@expo/ui';
import { presentationBackground } from '@expo/ui/swift-ui/modifiers';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { AppFonts, Type, useAppColors } from '@/constants/theme';

const DEFAULT_SNAP_POINTS: SnapPoint[] = [{ fraction: 0.58 }, { fraction: 0.88 }];

/**
 * A native bottom sheet: a short centred title above the content. `flush`
 * content runs the full width so flat rows reach the sheet's edges; other
 * content, such as a form field, sits inside the row inset.
 */
export function ChatBottomSheet({
  children,
  flush = false,
  onClose,
  snapPoints = DEFAULT_SNAP_POINTS,
  subtitle,
  title,
  visible,
}: {
  children: ReactNode;
  flush?: boolean;
  onClose: () => void;
  snapPoints?: SnapPoint[];
  subtitle?: string;
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
      snapPoints={snapPoints}
    >
      <RNHostView>
        <View style={styles.sheet}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[Type.subhead, styles.subtitle, { color: colors.textSecondary }]}>
              {subtitle}
            </Text>
          ) : null}
          <View style={[styles.body, !flush && styles.inset]}>{children}</View>
        </View>
      </RNHostView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingBottom: 20 },
  title: {
    fontFamily: AppFonts.semibold,
    fontSize: 17,
    paddingBottom: 10,
    paddingHorizontal: 20,
    paddingTop: 18,
    textAlign: 'center',
  },
  subtitle: { paddingBottom: 10, paddingHorizontal: 20, textAlign: 'center' },
  body: { flex: 1 },
  inset: { paddingHorizontal: 20 },
});

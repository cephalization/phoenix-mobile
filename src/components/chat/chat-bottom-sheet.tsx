import { BottomSheet, RNHostView, type SnapPoint } from '@expo/ui';
import { presentationBackground } from '@expo/ui/swift-ui/modifiers';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { RowInset } from '@/components/ui/list-row';
import { AppFonts, Type, useAppColors } from '@/constants/theme';

// The universal sheet pads its content 16 points from the top; the bottom
// keeps clear of the home indicator.
const SheetContentTop = 16;
const SheetContentBottom = 34;

const DEFAULT_SNAP_POINTS: SnapPoint[] = [{ fraction: 0.58 }, { fraction: 0.88 }];

/**
 * A native bottom sheet: a short title on the rows' inset above the content. `flush`
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
  const window = useWindowDimensions();

  // The hosted content doesn't follow the sheet's detent on iPhone Duo, open
  // or closed: it laid out taller than the sheet, and a long list's last rows
  // sat below the sheet's edge with nothing to scroll. The sheet takes one
  // detent and the content is sized to exactly that height.
  const fraction = tallestFraction(snapPoints);
  const height = Math.round(window.height * fraction) - SheetContentTop - SheetContentBottom;

  return (
    <BottomSheet
      isPresented={visible}
      modifiers={Platform.OS === 'ios' ? [presentationBackground(colors.background)] : undefined}
      // Rows reach the sheet's edges and keep their own inset.
      contentPadding={{ top: SheetContentTop }}
      onDismiss={onClose}
      showDragIndicator
      snapPoints={[{ fraction }]}
    >
      <RNHostView>
        <View style={[styles.sheet, { height }]}>
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

function tallestFraction(snapPoints: SnapPoint[]) {
  return Math.max(
    0.5,
    ...snapPoints.map((point) =>
      point === 'full' ? 0.9 : point === 'half' ? 0.5 : 'fraction' in point ? point.fraction : 0.5,
    ),
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingBottom: 20 },
  title: {
    fontFamily: AppFonts.semibold,
    fontSize: 17,
    paddingBottom: 10,
    paddingHorizontal: RowInset,
    paddingTop: 8,
  },
  subtitle: { paddingBottom: 10, paddingHorizontal: RowInset },
  body: { flex: 1 },
  inset: { paddingHorizontal: RowInset },
});

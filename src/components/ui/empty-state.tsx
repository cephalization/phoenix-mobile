import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { MotionPressable } from '@/components/motion-pressable';
import { AppFonts, Type, useAppColors } from '@/constants/theme';

/**
 * A plain message in place of content: an empty detail column, an empty list,
 * a failed load. No card. `loading` swaps the symbol for a spinner.
 */
export function EmptyState({
  action,
  art,
  fill = true,
  loading = false,
  message,
  symbol,
  title,
}: {
  title: string;
  message?: string;
  symbol?: SymbolViewProps['name'];
  /** Replaces the symbol, for the one place the Phoenix mark belongs. */
  art?: ReactNode;
  loading?: boolean;
  action?: { label: string; onPress: () => void };
  /** Centres in the available space; false keeps it compact inside a list. */
  fill?: boolean;
}) {
  const colors = useAppColors();

  return (
    <View style={[styles.state, fill && styles.fill]}>
      {loading ? (
        <ActivityIndicator color={colors.textSecondary} />
      ) : art ? (
        art
      ) : symbol ? (
        <SymbolView name={symbol} size={30} tintColor={colors.textTertiary} type="hierarchical" />
      ) : null}
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {message ? (
          <Text style={[Type.subhead, styles.message, { color: colors.textSecondary }]}>
            {message}
          </Text>
        ) : null}
      </View>
      {action ? (
        <MotionPressable
          accessibilityRole="button"
          haptic="light"
          onPress={action.onPress}
          style={[styles.action, { backgroundColor: colors.accent }]}
        >
          <Text style={[styles.actionLabel, { color: colors.accentForeground }]}>
            {action.label}
          </Text>
        </MotionPressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  state: { alignItems: 'center', gap: 12, paddingHorizontal: 28, paddingVertical: 40 },
  fill: { flex: 1, justifyContent: 'center' },
  copy: { alignItems: 'center', gap: 4, maxWidth: 320 },
  title: { fontFamily: AppFonts.semibold, fontSize: 17, textAlign: 'center' },
  message: { textAlign: 'center' },
  action: {
    alignItems: 'center',
    borderRadius: 24,
    justifyContent: 'center',
    marginTop: 4,
    minHeight: 48,
    paddingHorizontal: 22,
  },
  actionLabel: { fontFamily: AppFonts.semibold, fontSize: 15 },
});

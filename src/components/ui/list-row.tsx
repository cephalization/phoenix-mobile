import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Type, useAppColors } from '@/constants/theme';
import { haptics } from '@/lib/haptics';

/** Horizontal inset shared by rows, section headers, and stat strips. */
export const RowInset = 20;

type ListRowProps = {
  title: string;
  /** `danger` for a destructive action row; the layout stays the same. */
  titleTone?: 'default' | 'danger';
  /** A second line: an excerpt, an error, or counts. */
  subtitle?: string;
  /** Sets the second line in the monospaced face, for IDs and counts. */
  subtitleMono?: boolean;
  subtitleTone?: 'default' | 'danger';
  leading?: ReactNode;
  /** Short trailing value, such as a latency or a relative time, set in monospace. */
  meta?: string;
  trailing?: ReactNode;
  /**
   * `sidebar` rows sit inside the list gutter and show selection as a raised
   * fill; `flat` rows run the full width and rely on `RowSeparator`.
   */
  variant?: 'sidebar' | 'flat';
  selected?: boolean;
  /**
   * Makes the row one choice in a set: `true` shows a checkmark. Leave unset
   * for rows that navigate or act.
   */
  checked?: boolean;
  /** Recedes a row that matters less, such as a quiet project. */
  dimmed?: boolean;
  titleLines?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityHint?: string;
  accessibilityLabel?: string;
};

/**
 * The app's one row. No card, tile, or chevron: a title, an optional second
 * line, and a monospaced trailing value. Selection is a fill, not a colour.
 */
export function ListRow({
  accessibilityHint,
  accessibilityLabel,
  checked,
  dimmed = false,
  leading,
  meta,
  onLongPress,
  onPress,
  selected = false,
  subtitle,
  subtitleMono = false,
  subtitleTone = 'default',
  title,
  titleLines = 1,
  titleTone = 'default',
  trailing,
  variant = 'sidebar',
}: ListRowProps) {
  const colors = useAppColors();

  const content = (
    <>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.body}>
        <View style={styles.firstLine}>
          <Text
            numberOfLines={titleLines}
            style={[
              Type.headline,
              styles.title,
              { color: titleTone === 'danger' ? colors.danger : colors.text },
            ]}
          >
            {title}
          </Text>
          {meta ? (
            <Text numberOfLines={1} style={[Type.mono, { color: colors.textSecondary }]}>
              {meta}
            </Text>
          ) : null}
        </View>
        {subtitle ? (
          <Text
            numberOfLines={1}
            style={[
              subtitleMono ? Type.mono : Type.subhead,
              { color: subtitleTone === 'danger' ? colors.danger : colors.textSecondary },
            ]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {checked ? (
        <SymbolView
          name={{ android: 'check', ios: 'checkmark', web: 'check' }}
          size={16}
          tintColor={colors.text}
          weight="semibold"
        />
      ) : null}
    </>
  );

  const rowStyle = [
    variant === 'sidebar' ? styles.sidebar : styles.flat,
    selected && { backgroundColor: colors.rowSelected },
    dimmed && !selected && styles.dimmed,
  ];

  // A row without an action is information, not a button.
  if (!onPress) {
    return (
      <View accessibilityLabel={accessibilityLabel} accessible style={rowStyle}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={checked === undefined ? 'button' : 'radio'}
      accessibilityState={checked === undefined ? { selected } : { checked }}
      android_ripple={{ color: colors.ripple }}
      onLongPress={onLongPress}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      style={({ pressed }) => [rowStyle, pressed && { backgroundColor: colors.rowSelected }]}
    >
      {content}
    </Pressable>
  );
}

/** The hairline between flat rows, inset to the text so the edge stays clean. */
export function RowSeparator({ inset = RowInset }: { inset?: number }) {
  const colors = useAppColors();

  return (
    <View style={[styles.separator, { backgroundColor: colors.separator, marginLeft: inset }]} />
  );
}

const styles = StyleSheet.create({
  sidebar: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  flat: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: RowInset,
    paddingVertical: 11,
  },
  dimmed: { opacity: 0.55 },
  leading: { alignItems: 'center', justifyContent: 'center', minWidth: 18 },
  body: { flex: 1, gap: 3, minWidth: 0 },
  firstLine: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  title: { flex: 1 },
  separator: { height: StyleSheet.hairlineWidth },
});

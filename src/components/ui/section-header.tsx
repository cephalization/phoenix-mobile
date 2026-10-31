import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RowInset } from '@/components/ui/list-row';
import { Type, useAppColors } from '@/constants/theme';
import { haptics } from '@/lib/haptics';

/**
 * A quiet label followed by a hairline that runs to the edge. When `onToggle`
 * is set the header folds its section, and a folded section shows its count.
 */
export function SectionHeader({
  count,
  expanded = true,
  label,
  onToggle,
}: {
  label: string;
  count?: number;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const colors = useAppColors();
  const text = !expanded && count !== undefined ? `${label} (${count})` : label;

  const content = (
    <>
      <Text style={[Type.label, { color: colors.textSecondary }]}>{text}</Text>
      <View style={[styles.rule, { backgroundColor: colors.separator }]} />
      {onToggle ? (
        <SymbolView
          name={{
            android: expanded ? 'expand_more' : 'chevron_right',
            ios: expanded ? 'chevron.down' : 'chevron.right',
            web: expanded ? 'expand_more' : 'chevron_right',
          }}
          size={10}
          tintColor={colors.textTertiary}
          weight="semibold"
        />
      ) : null}
    </>
  );

  if (!onToggle) {
    return (
      <View accessibilityRole="header" style={styles.header}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityLabel={text}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={() => {
        haptics.selection();
        onToggle();
      }}
      style={[styles.header, styles.toggle]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 6,
    paddingHorizontal: RowInset,
    paddingTop: 18,
  },
  // Keeps a folding header at least 48 points tall without spacing it apart.
  toggle: { minHeight: 48, paddingTop: 12 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
});

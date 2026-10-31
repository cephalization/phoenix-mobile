import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RowInset } from '@/components/ui/list-row';
import { Type, useAppColors } from '@/constants/theme';
import { haptics } from '@/lib/haptics';

/**
 * The Traces list's filter: a search-field-shaped control that shows the
 * applied expression in monospace, or a placeholder. Tapping it opens the
 * filter sheet; the clear button removes the filter in place.
 */
export function TraceFilterField({
  expression,
  onClear,
  onPress,
}: {
  expression: string | null;
  onPress: () => void;
  onClear: () => void;
}) {
  const colors = useAppColors();
  const active = expression !== null;

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityHint="Opens the trace filter"
        accessibilityLabel={active ? `Trace filter, ${expression}` : 'Filter traces'}
        accessibilityRole="button"
        hitSlop={{ bottom: 4, top: 4 }}
        onPress={onPress}
        style={({ pressed }) => [
          styles.field,
          { backgroundColor: pressed ? colors.rowSelected : colors.backgroundSelected },
        ]}
      >
        <SymbolView
          name={{
            android: 'filter_list',
            ios: active ? 'line.3.horizontal.decrease.circle.fill' : 'line.3.horizontal.decrease',
            web: 'filter_list',
          }}
          size={15}
          tintColor={active ? colors.text : colors.textTertiary}
          weight="medium"
        />
        <Text
          ellipsizeMode="tail"
          numberOfLines={2}
          style={[
            active ? Type.mono : Type.body,
            styles.text,
            { color: active ? colors.text : colors.textTertiary },
          ]}
        >
          {expression ?? 'Filter traces'}
        </Text>
        {active ? (
          <Pressable
            accessibilityLabel="Clear filter"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              haptics.selection();
              onClear();
            }}
            style={styles.clear}
          >
            <SymbolView
              name={{ android: 'cancel', ios: 'xmark.circle.fill', web: 'cancel' }}
              size={17}
              tintColor={colors.textTertiary}
            />
          </Pressable>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: RowInset, paddingVertical: 4 },
  field: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
    paddingLeft: 12,
    paddingVertical: 4,
  },
  text: { flex: 1, paddingRight: 12, paddingVertical: 6 },
  // The clear glyph is small; its pressable keeps a full-height target at the field's end.
  clear: {
    alignItems: 'center',
    alignSelf: 'stretch',
    justifyContent: 'center',
    marginLeft: -12,
    minWidth: 44,
  },
});

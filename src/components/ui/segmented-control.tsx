import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppFonts, useAppColors } from '@/constants/theme';
import { haptics } from '@/lib/haptics';

export type SegmentedControlProps<T extends string> = {
  options: readonly { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
};

/** A segmented control for Android and web; iOS uses the system one. */
export function SegmentedControl<T extends string>({
  onChange,
  options,
  value,
}: SegmentedControlProps<T>) {
  const colors = useAppColors();

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.track, { backgroundColor: colors.backgroundSelected }]}
    >
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={option.value}
            onPress={() => {
              if (selected) return;
              haptics.selection();
              onChange(option.value);
            }}
            style={[styles.segment, selected && { backgroundColor: colors.backgroundElement }]}
          >
            <Text style={[styles.label, { color: selected ? colors.text : colors.textSecondary }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { borderRadius: 10, flexDirection: 'row', gap: 2, padding: 2 },
  segment: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    justifyContent: 'center',
    minHeight: 36,
  },
  label: { fontFamily: AppFonts.semibold, fontSize: 13 },
});

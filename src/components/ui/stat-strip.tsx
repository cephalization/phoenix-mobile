import { StyleSheet, Text, View } from 'react-native';

import { RowInset } from '@/components/ui/list-row';
import { Type, useAppColors } from '@/constants/theme';

export type Stat = {
  label: string;
  value: string;
  /** `danger` only when the value is a nonzero problem, such as errors. */
  tone?: 'default' | 'danger';
};

/** A row of figures divided by hairlines. Replaces stat cards. */
export function StatStrip({ stats }: { stats: Stat[] }) {
  const colors = useAppColors();

  return (
    <View accessibilityRole="summary" style={styles.strip}>
      {stats.map((stat, index) => (
        <View
          accessibilityLabel={`${stat.label}, ${stat.value}`}
          key={stat.label}
          style={[
            styles.cell,
            index > 0 && [styles.divided, { borderLeftColor: colors.separator }],
          ]}
        >
          <Text numberOfLines={1} style={[Type.label, { color: colors.textSecondary }]}>
            {stat.label}
          </Text>
          <Text
            adjustsFontSizeToFit
            numberOfLines={1}
            style={[
              Type.monoValue,
              { color: stat.tone === 'danger' ? colors.danger : colors.text },
            ]}
          >
            {stat.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', paddingHorizontal: RowInset, paddingVertical: 10 },
  cell: { flex: 1, gap: 2, minWidth: 0 },
  divided: { borderLeftWidth: StyleSheet.hairlineWidth, paddingLeft: 10 },
});

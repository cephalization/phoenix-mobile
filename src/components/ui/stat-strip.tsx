import { StyleSheet, Text, View } from 'react-native';

import { RowInset } from '@/components/ui/list-row';
import { Type, useAppColors } from '@/constants/theme';

export type Stat = {
  label: string;
  value: string;
  /** `danger` only when the value is a nonzero problem, such as errors. */
  tone?: 'default' | 'danger';
  /** A short comparison under the figure, such as `was 2.1%` or `+12%`. */
  detail?: string;
  /** `danger` when the comparison is the problem: errors up, latency worse. */
  detailTone?: 'default' | 'danger';
};

/** A row of figures divided by hairlines. Replaces stat cards. */
export function StatStrip({ stats }: { stats: Stat[] }) {
  const colors = useAppColors();

  return (
    <View accessibilityRole="summary" style={styles.strip}>
      {stats.map((stat, index) => (
        <View
          accessibilityLabel={`${stat.label}, ${stat.value}${stat.detail ? `, ${stat.detail}` : ''}`}
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
          {stat.detail ? (
            <Text
              numberOfLines={1}
              style={[
                Type.mono,
                { color: stat.detailTone === 'danger' ? colors.danger : colors.textTertiary },
              ]}
            >
              {stat.detail}
            </Text>
          ) : null}
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

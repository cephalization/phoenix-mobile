import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { RowInset } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { Type, useAppColors } from '@/constants/theme';

/**
 * A chart under a section header, with its scale's top value above the plot
 * and the window's first and last bin times beneath it. `value` is the figure
 * the chart is about right now: the selected bin's, or the window's total.
 */
export function ChartSection({
  children,
  endLabel,
  maximumLabel,
  startLabel,
  title,
  value,
}: {
  children: ReactNode;
  title: string;
  value?: string;
  maximumLabel?: string;
  startLabel?: string;
  endLabel?: string;
}) {
  const colors = useAppColors();

  return (
    <View>
      <SectionHeader label={title} />
      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text numberOfLines={1} style={[Type.monoValue, styles.value, { color: colors.text }]}>
            {value ?? ' '}
          </Text>
          {maximumLabel ? (
            <Text style={[Type.mono, { color: colors.textTertiary }]}>{maximumLabel}</Text>
          ) : null}
        </View>
        {children}
        {startLabel || endLabel ? (
          <View style={styles.axis}>
            <Text style={[Type.mono, { color: colors.textTertiary }]}>{startLabel}</Text>
            <Text style={[Type.mono, { color: colors.textTertiary }]}>{endLabel}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 6, paddingHorizontal: RowInset, paddingTop: 2 },
  topLine: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  value: { flexShrink: 1 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
});

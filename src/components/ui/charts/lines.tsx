import Svg, { Circle, Line, Path } from 'react-native-svg';

import { useAppColors } from '@/constants/theme';

import { linePath } from './scale';

export type LineSeries = {
  key: string;
  values: readonly (number | null)[];
  /** `primary` is the headline series in text colour; `secondary` recedes. */
  emphasis: 'primary' | 'secondary';
};

/**
 * Lines across the bins, broken where a bin has no value. The headline series
 * is solid text colour and the comparison series a receded dashed line, so two
 * percentiles read apart without a legend colour. A selected bin draws a rule
 * and marks each series' value on it.
 */
export function Lines({
  height,
  maximum,
  selected = null,
  series,
  width,
}: {
  height: number;
  maximum: number;
  selected?: number | null;
  series: readonly LineSeries[];
  width: number;
}) {
  const colors = useAppColors();
  const count = series[0]?.values.length ?? 0;
  const step = count > 0 ? width / count : width;
  // Leave room for the stroke at the top and bottom edges.
  const inset = 2;
  const plotHeight = height - inset * 2;

  return (
    <Svg height={height} width={width}>
      {selected !== null ? (
        <Line
          stroke={colors.border}
          strokeWidth={1}
          x1={step * (selected + 0.5)}
          x2={step * (selected + 0.5)}
          y1={0}
          y2={height}
        />
      ) : null}
      {series.map((line) => (
        <Path
          d={linePath(line.values, width, plotHeight, maximum)}
          fill="none"
          key={line.key}
          stroke={line.emphasis === 'primary' ? colors.text : colors.textTertiary}
          strokeDasharray={line.emphasis === 'primary' ? undefined : '3 3'}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={line.emphasis === 'primary' ? 1.75 : 1.25}
          transform={`translate(0 ${inset})`}
        />
      ))}
      {selected !== null
        ? series.map((line) => {
            const value = line.values[selected];

            if (value === null || value === undefined || maximum <= 0) return null;

            return (
              <Circle
                cx={step * (selected + 0.5)}
                cy={inset + plotHeight - (Math.min(value, maximum) / maximum) * plotHeight}
                fill={colors.background}
                key={line.key}
                r={3}
                stroke={line.emphasis === 'primary' ? colors.text : colors.textTertiary}
                strokeWidth={1.5}
              />
            );
          })
        : null}
      <Line
        stroke={colors.separator}
        strokeWidth={1}
        x1={0}
        x2={width}
        y1={height - 0.5}
        y2={height - 0.5}
      />
    </Svg>
  );
}

/** A row-sized trend line, for a score beside its name. */
export function MiniLine({
  height = 22,
  values,
  width = 72,
}: {
  height?: number;
  values: readonly (number | null)[];
  width?: number;
}) {
  const colors = useAppColors();
  let maximum = 0;
  let minimum = Number.POSITIVE_INFINITY;

  for (const value of values) {
    if (value === null) continue;
    maximum = Math.max(maximum, value);
    minimum = Math.min(minimum, value);
  }

  // Stretch the line over its own range so a small drift is visible at row size.
  const floor = Number.isFinite(minimum) ? minimum : 0;
  const span = Math.max(maximum - floor, 0.0001);
  const shifted = values.map((value) => (value === null ? null : value - floor));

  return (
    <Svg height={height} width={width}>
      <Path
        d={linePath(shifted, width, height - 4, span)}
        fill="none"
        stroke={colors.textSecondary}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        transform="translate(0 2)"
      />
    </Svg>
  );
}

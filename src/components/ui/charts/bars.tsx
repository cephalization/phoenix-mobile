import Svg, { Line, Path, Rect } from 'react-native-svg';

import { useAppColors } from '@/constants/theme';

export type BarValue = {
  /** The main share of the bar: OK traces, or the whole value. */
  base: number;
  /** A share stacked on top in the alert colour: error traces. */
  alert?: number;
};

type Column = { x: number; width: number; baseTop: number; alertTop: number; bottom: number };

/**
 * Each bin's column geometry: the base share from the bottom and the alert
 * share stacked above it. A bin with any traffic keeps a visible sliver, so a
 * quiet hour still reads as alive.
 */
function columns(
  values: readonly BarValue[],
  width: number,
  height: number,
  maximum: number,
  fill: number,
): Column[] {
  const step = values.length > 0 ? width / values.length : width;
  const barWidth = Math.max(0.5, step * fill);
  const scale = maximum > 0 ? height / maximum : 0;

  return values.map((value, index) => {
    const alert = value.alert ?? 0;
    const total = value.base + alert;
    const totalHeight = total > 0 ? Math.min(height, Math.max(1.5, total * scale)) : 0;
    const alertHeight = alert > 0 ? Math.min(totalHeight, Math.max(1.5, alert * scale)) : 0;

    return {
      x: step * index + (step - barWidth) / 2,
      width: barWidth,
      baseTop: height - totalHeight + alertHeight,
      alertTop: height - totalHeight,
      bottom: height,
    };
  });
}

/** One SVG path of rectangles, so a week of hourly bins is a handful of nodes. */
function rectanglesPath(rectangles: readonly { x: number; y: number; w: number; h: number }[]) {
  let path = '';

  for (const { h, w, x, y } of rectangles) {
    if (h > 0)
      path += `M${x.toFixed(2)} ${y.toFixed(2)}h${w.toFixed(2)}v${h.toFixed(2)}h${(-w).toFixed(2)}Z`;
  }

  return path;
}

function basePath(geometry: readonly Column[], keep: (index: number) => boolean) {
  return rectanglesPath(
    geometry.flatMap((column, index) =>
      keep(index)
        ? [{ x: column.x, y: column.baseTop, w: column.width, h: column.bottom - column.baseTop }]
        : [],
    ),
  );
}

function alertPath(geometry: readonly Column[], keep: (index: number) => boolean) {
  return rectanglesPath(
    geometry.flatMap((column, index) =>
      keep(index)
        ? [
            {
              x: column.x,
              y: column.alertTop,
              w: column.width,
              h: column.baseTop - column.alertTop,
            },
          ]
        : [],
    ),
  );
}

/**
 * Columns, one per bin, with an optional alert share stacked on top. The
 * base is monochrome and only the alert share takes `danger`, so a healthy
 * chart stays quiet. The selected bin is drawn in full text colour over a
 * faint column fill, and the others recede while a bin is selected.
 */
export function Bars({
  height,
  maximum,
  selected = null,
  values,
  width,
}: {
  height: number;
  maximum: number;
  selected?: number | null;
  values: readonly BarValue[];
  width: number;
}) {
  const colors = useAppColors();
  const step = values.length > 0 ? width / values.length : width;
  const fill = step >= 6 ? (step - 2) / step : step >= 3 ? (step - 1) / step : 1;
  const geometry = columns(values, width, height, maximum, fill);
  const others = (index: number) => index !== selected;
  const only = (index: number) => index === selected;
  const receded = selected === null ? 1 : 0.45;

  return (
    <Svg height={height} width={width}>
      {selected !== null ? (
        <Rect fill={colors.rowSelected} height={height} rx={2} width={step} x={step * selected} />
      ) : null}
      <Path d={basePath(geometry, others)} fill={colors.textTertiary} opacity={receded} />
      <Path d={alertPath(geometry, others)} fill={colors.danger} opacity={receded} />
      {selected !== null ? (
        <>
          <Path d={basePath(geometry, only)} fill={colors.text} />
          <Path d={alertPath(geometry, only)} fill={colors.danger} />
        </>
      ) : null}
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

/**
 * A row-sized pulse: the last bins of traffic as hairline columns, errors on
 * top in `danger`. No axes or interaction; the row's own label carries the
 * numbers for assistive technologies.
 */
export function MiniBars({
  height = 22,
  values,
  width = 72,
}: {
  height?: number;
  values: readonly BarValue[];
  width?: number;
}) {
  const colors = useAppColors();
  let maximum = 0;

  for (const value of values) maximum = Math.max(maximum, value.base + (value.alert ?? 0));

  const geometry = columns(values, width, height, maximum, 0.62);
  const all = () => true;
  const step = values.length > 0 ? width / values.length : width;

  return (
    <Svg height={height} width={width}>
      {/* A hairline floor keeps empty hours visible as a gap in the pulse. */}
      <Line
        stroke={colors.separator}
        strokeWidth={1}
        x1={0}
        x2={Math.max(0, width - (step - step * 0.62) / 2)}
        y1={height - 0.5}
        y2={height - 0.5}
      />
      <Path d={basePath(geometry, all)} fill={colors.textTertiary} />
      <Path d={alertPath(geometry, all)} fill={colors.danger} />
    </Svg>
  );
}

/** A rounded top for a value axis: 1, 2, 2.5, or 5 times a power of ten. */
export function niceMaximum(value: number): number {
  if (!(value > 0)) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(value));

  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }

  return 10 * magnitude;
}

/** The bin under `x` on a chart `width` wide with `count` bins. */
export function indexAt(x: number, width: number, count: number): number {
  if (width <= 0 || count <= 0) return 0;

  return Math.min(count - 1, Math.max(0, Math.floor((x / width) * count)));
}

/** An SVG path through the non-null values, broken where a value is missing. */
export function linePath(
  values: readonly (number | null)[],
  width: number,
  height: number,
  maximum: number,
): string {
  if (values.length === 0 || maximum <= 0) return '';

  const step = width / values.length;
  let path = '';
  let drawing = false;

  values.forEach((value, index) => {
    if (value === null) {
      drawing = false;

      return;
    }

    const x = step * (index + 0.5);
    const y = height - (Math.min(value, maximum) / maximum) * height;
    path += `${drawing ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    drawing = true;
  });

  return path;
}

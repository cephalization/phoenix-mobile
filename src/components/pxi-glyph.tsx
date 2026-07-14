import Svg, { Rect } from 'react-native-svg';

const CELL_SIZE = 5.5;
const CELL_RADIUS = 1.1;
const GRID = 6.5;
const VIEW_BOX_SIZE = 18.5;

const cells = [
  { x: 0, y: 0 },
  { x: GRID * 2, y: 0 },
  { x: GRID, y: GRID },
  { x: 0, y: GRID * 2 },
  { x: GRID * 2, y: GRID * 2 },
];

export function PxiGlyph({ color = 'currentColor', size = 22 }: { color?: string; size?: number }) {
  return (
    <Svg
      height={size}
      viewBox={`0 0 ${VIEW_BOX_SIZE} ${VIEW_BOX_SIZE}`}
      width={size}>
      {cells.map((cell, index) => (
        <Rect
          fill={color}
          height={CELL_SIZE}
          key={index}
          rx={CELL_RADIUS}
          ry={CELL_RADIUS}
          width={CELL_SIZE}
          x={cell.x}
          y={cell.y}
        />
      ))}
    </Svg>
  );
}

import type { ReactNode } from 'react';

import { useContentColumnStyle } from '@/features/duo/layout';

type ContentColumnStyle = ReturnType<typeof useContentColumnStyle>;

/**
 * Resolves the content column style where it is rendered, so a list that is
 * handed to a `DuoArrangement` pane pads for that pane's safe-area insets
 * rather than the screen's.
 */
export function ContentColumn({
  children,
  padding,
}: {
  children: (column: ContentColumnStyle) => ReactNode;
  padding: number;
}) {
  const column = useContentColumnStyle(padding);

  return children(column);
}

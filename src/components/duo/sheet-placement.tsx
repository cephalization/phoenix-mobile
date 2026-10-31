import { useEffect } from 'react';

import { useDuoLayout } from '@/features/duo/layout';

import { setSheetPlacement } from '../../../modules/duo-native';

/**
 * Keeps native form sheets beside the vertical system bar on a regular-width
 * window (the open iPhone Duo), where the system would otherwise dock them to
 * the leading edge over the list the person is working from.
 */
export function DuoSheetPlacement() {
  const { isRegularWidth, systemBarEdge } = useDuoLayout();

  useEffect(() => {
    setSheetPlacement(
      isRegularWidth && systemBarEdge === 'trailing'
        ? 'trailing'
        : isRegularWidth && systemBarEdge === 'leading'
          ? 'leading'
          : 'automatic',
    );
  }, [isRegularWidth, systemBarEdge]);

  return null;
}

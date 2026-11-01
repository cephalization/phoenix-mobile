import { SymbolView } from 'expo-symbols';

import { useAppColors } from '@/constants/theme';

/**
 * Trails a row that would open to nothing while its server is unreachable: a
 * project or instance with no saved data. Receded, never a colour; the row's
 * own text says why.
 */
export function NotSavedOfflineGlyph() {
  const colors = useAppColors();

  return (
    <SymbolView
      accessible={false}
      name={{ android: 'cloud_off', ios: 'icloud.slash', web: 'cloud_off' }}
      size={15}
      tintColor={colors.textTertiary}
    />
  );
}

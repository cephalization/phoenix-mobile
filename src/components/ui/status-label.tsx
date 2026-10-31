import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { Type, useAppColors } from '@/constants/theme';

export type StatusTone = 'ok' | 'error' | 'pending' | 'neutral';

const Symbols = {
  ok: { android: 'check_circle', ios: 'checkmark.circle', web: 'check_circle' },
  error: { android: 'warning', ios: 'exclamationmark.triangle.fill', web: 'warning' },
  pending: { android: 'pending', ios: 'circle.dashed', web: 'pending' },
  neutral: { android: 'radio_button_unchecked', ios: 'circle', web: 'radio_button_unchecked' },
} as const;

/**
 * Status as a symbol and a word, never a bare coloured dot. Only `ok` and
 * `error` carry colour; `label` may be omitted where a row's text says it.
 */
export function StatusLabel({
  label,
  size = 13,
  tone,
}: {
  tone: StatusTone;
  label?: string;
  size?: number;
}) {
  const colors = useAppColors();

  const color =
    tone === 'ok' ? colors.success : tone === 'error' ? colors.danger : colors.textSecondary;

  return (
    <View accessibilityLabel={label} accessible={label !== undefined} style={styles.status}>
      <SymbolView name={Symbols[tone]} size={size} tintColor={color} weight="semibold" />
      {label ? <Text style={[Type.label, { color }]}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  status: { alignItems: 'center', flexDirection: 'row', gap: 5 },
});

import { Host } from '@expo/ui';
import { Slider as ComposeSlider } from '@expo/ui/jetpack-compose';
import { StyleSheet } from 'react-native';

import { useAppColors } from '@/constants/theme';

import type { ScoreSliderProps } from './score-slider';

// Android: the Material 3 slider derives its track colors from the hosted
// Compose theme, and the light-scheme inactive track is invisible on the app's
// white cards. Pass explicit token colors instead of relying on the seed theme.
export function ScoreSlider({ disabled, max, min, onValueChange, step, value }: ScoreSliderProps) {
  const colors = useAppColors();
  const steps = step > 0 ? Math.max(0, Math.round((max - min) / step) - 1) : 0;

  return (
    <Host ignoreSafeArea="all" style={styles.host}>
      <ComposeSlider
        colors={{
          activeTickColor: colors.background,
          activeTrackColor: colors.brandText,
          inactiveTickColor: colors.background,
          inactiveTrackColor: colors.textSecondary,
          thumbColor: colors.brandText,
        }}
        enabled={!disabled}
        max={max}
        min={min}
        onValueChange={(next) =>
          onValueChange(step > 0 ? Math.round((next - min) / step) * step + min : next)
        }
        steps={steps}
        value={value}
      />
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { height: 36, width: '100%' },
});

import { Host, Slider } from '@expo/ui';
import { StyleSheet } from 'react-native';

import { useAppColors } from '@/constants/theme';

export type ScoreSliderProps = {
  disabled?: boolean;
  max: number;
  min: number;
  onValueChange: (value: number) => void;
  step: number;
  value: number;
};

// iOS and web: the SwiftUI slider and the HTML range input draw their own
// visible tracks in both color schemes; only the tint needs theming.
export function ScoreSlider({ disabled, max, min, onValueChange, step, value }: ScoreSliderProps) {
  const colors = useAppColors();

  return (
    <Host ignoreSafeArea="all" seedColor={colors.brandText} style={styles.host}>
      <Slider
        disabled={disabled}
        max={max}
        min={min}
        onValueChange={onValueChange}
        step={step}
        value={value}
      />
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { height: 36, width: '100%' },
});

import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet } from 'react-native';

import { haptics } from '@/lib/haptics';

import type { SegmentedControlProps } from './segmented-control';

/** UIKit's segmented control, so it takes the system's material and sizing. */
export function SegmentedControl<T extends string>({
  onChange,
  options,
  value,
}: SegmentedControlProps<T>) {
  return (
    <Host matchContents={{ vertical: true }} style={styles.host}>
      <Picker
        modifiers={[pickerStyle('segmented')]}
        onSelectionChange={(selection: string) => {
          const next = options.find((option) => option.value === selection);

          if (!next || next.value === value) return;
          haptics.selection();
          onChange(next.value);
        }}
        selection={value}
      >
        {options.map((option) => (
          <Text key={option.value} modifiers={[tag(option.value)]}>
            {option.label}
          </Text>
        ))}
      </Picker>
    </Host>
  );
}

const styles = StyleSheet.create({ host: { alignSelf: 'stretch' } });

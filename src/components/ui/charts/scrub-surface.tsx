import { type ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  GestureDetector,
  useExclusiveGestures,
  usePanGesture,
  useTapGesture,
} from 'react-native-gesture-handler';

import { haptics } from '@/lib/haptics';

import { indexAt } from './scale';

/**
 * The touch layer every interactive chart shares. A horizontal drag scrubs
 * across bins and a tap picks one (a second tap on it clears the selection);
 * vertical drags fall through to the page so charts never trap scrolling.
 * Each bin change ticks the selection haptic. VoiceOver and TalkBack treat
 * the chart as adjustable: swiping up or down steps through the bins, and
 * `accessibilityValue` reads the selected one.
 */
export function ScrubSurface({
  accessibilityLabel,
  accessibilityValue,
  children,
  count,
  height,
  onSelect,
  selected,
}: {
  accessibilityLabel: string;
  /** The selected bin, read after the label. */
  accessibilityValue?: string;
  children: (width: number) => ReactNode;
  count: number;
  height: number;
  selected: number | null;
  onSelect: (index: number | null) => void;
}) {
  const [width, setWidth] = useState(0);

  const pick = (x: number, toggle: boolean) => {
    const index = indexAt(x, width, count);

    if (toggle && index === selected) {
      haptics.selection();
      onSelect(null);

      return;
    }

    if (index !== selected) {
      haptics.selection();
      onSelect(index);
    }
  };

  const pan = usePanGesture({
    activeOffsetX: [-6, 6],
    failOffsetY: [-12, 12],
    runOnJS: true,
    onActivate: (event) => pick(event.x, false),
    onUpdate: (event) => pick(event.x, false),
  });

  const tap = useTapGesture({ runOnJS: true, onActivate: (event) => pick(event.x, true) });
  const gesture = useExclusiveGestures(pan, tap);

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="adjustable"
        accessibilityValue={
          accessibilityValue === undefined ? undefined : { text: accessibilityValue }
        }
        accessible
        onAccessibilityAction={(event) => {
          const step = event.nativeEvent.actionName === 'increment' ? 1 : -1;
          const from = selected ?? (step > 0 ? -1 : count);
          onSelect(Math.min(count - 1, Math.max(0, from + step)));
        }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={[styles.surface, { height }]}
      >
        {width > 0 ? children(width) : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  surface: { width: '100%' },
});

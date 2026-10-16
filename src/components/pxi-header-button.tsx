import { router, type Stack } from 'expo-router';
import type { ComponentProps } from 'react';
import { Platform, StyleSheet } from 'react-native';

import { useAppColors } from '@/constants/theme';
import type { PxiActionRouteParams } from '@/features/pxi/actions';
import { usePxiPaneStore } from '@/features/pxi/pane-store';
import type { PhoenixInstance } from '@/types/instance';

import { MotionPressable } from './motion-pressable';
import { PxiGlyph } from './pxi-glyph';

const pxiGlyphTemplate = require('@/assets/images/pxi-glyph.png');

type ScreenOptions = Exclude<
  NonNullable<ComponentProps<typeof Stack.Screen>['options']>,
  (...args: never[]) => object
>;

/**
 * Opens PXI for an instance: beside the current screen when the window is
 * regular width (the Duo's inner display, an iPad, a wide browser window),
 * otherwise as the full-screen chat route. A second press closes the pane.
 */
export function openPxi(instance: PhoenixInstance, onPaneOpened?: () => void) {
  const pane = usePxiPaneStore.getState();

  if (!pane.available) {
    router.push({ pathname: '/instances/[id]/chat', params: { id: instance.id } });

    return;
  }

  if (pane.instanceId === instance.id) {
    pane.close();

    return;
  }

  pane.open(instance.id);
  onPaneOpened?.();
}

/**
 * Runs a contextual PXI action. An action is a task with a result and an end,
 * so it always presents as the action sheet route: a bottom sheet on compact
 * width, a full-height sheet beside the vertical bar on regular width. The
 * PXI column is reserved for the persistent chat.
 */
export function openPxiAction(params: PxiActionRouteParams) {
  router.push({ pathname: '/instances/[id]/pxi-action', params });
}

/**
 * Header options that add the PXI button to a native stack screen. On iOS the
 * button is a native bar item with a template image, which is what lets iOS
 * move it into iPhone Duo's vertical bar under the Back button; a custom view
 * would stay in the horizontal bar. Other platforms render the pressable.
 */
export function usePxiHeaderOptions(
  instance: PhoenixInstance | undefined,
  onPaneOpened?: () => void,
): Pick<ScreenOptions, 'headerRight' | 'unstable_headerRightItems'> {
  const paneOpen = usePxiPaneStore(
    (state) => instance !== undefined && state.instanceId === instance.id,
  );

  if (instance === undefined) return {};

  const label = paneOpen ? 'Close PXI' : 'PXI';
  const accessibilityLabel = paneOpen ? 'Close PXI' : `Open PXI for ${instance.name}`;
  const onPress = () => openPxi(instance, onPaneOpened);

  if (Platform.OS === 'ios') {
    return {
      unstable_headerRightItems: () => [
        {
          type: 'button',
          accessibilityLabel,
          icon: { type: 'image', source: pxiGlyphTemplate },
          label,
          onPress,
          selected: paneOpen,
        },
      ],
    };
  }

  return {
    headerRight: () => (
      <PxiHeaderButton accessibilityLabel={accessibilityLabel} onPress={onPress} />
    ),
  };
}

export function PxiHeaderButton({
  accessibilityLabel,
  onPress,
}: {
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const colors = useAppColors();

  return (
    <MotionPressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      scaleTo={0.92}
      style={[
        styles.button,
        {
          backgroundColor: colors.accent,
          borderColor: colors.background,
        },
      ]}
    >
      <PxiGlyph color={colors.accentForeground} size={20} />
    </MotionPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 2,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
});

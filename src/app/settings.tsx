import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { router, Stack } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { barButton } from '@/components/duo/column-header';
import { ListRow, RowInset } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Type, useAppColors } from '@/constants/theme';
import { phoenixQueryKeys } from '@/hooks/use-phoenix-data';
import { haptics } from '@/lib/haptics';
import { confirmAction } from '@/lib/confirm';
import { useInstanceStore } from '@/store/instances';
import { type Appearance, useSettingsStore } from '@/store/settings';
import { useContentColumnStyle } from '@/features/duo/layout';

const appearanceOptions: readonly { label: string; value: Appearance }[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

export default function SettingsScreen() {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  // Pads clear of iPhone Duo's vertical bar, which runs down a sheet's trailing edge.
  const column = useContentColumnStyle(0);
  const queryClient = useQueryClient();
  const appearance = useSettingsStore((state) => state.appearance);
  const setAppearance = useSettingsStore((state) => state.setAppearance);
  const instances = useInstanceStore((state) => state.instances);
  const clearInstances = useInstanceStore((state) => state.clearInstances);

  const clearConnections = () => {
    confirmAction({
      title: 'Remove all connections?',
      message:
        'Every saved Phoenix connection will be removed from this device. PXI chats stay on their Phoenix servers.',
      confirmLabel: 'Remove all',
      onConfirm: async () => {
        try {
          await clearInstances();
          queryClient.removeQueries({ queryKey: phoenixQueryKeys.all });
          haptics.success();
        } catch {
          haptics.error();
        }
      },
    });
  };

  const saved =
    instances.length === 1
      ? '1 instance on this device'
      : `${instances.length} instances on this device`;

  return (
    <ScrollView
      contentContainerStyle={[styles.content, column, { paddingBottom: 24 + insets.bottom }]}
      contentInsetAdjustmentBehavior="automatic"
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      {/* The sheet's own way out besides the swipe: at the top of iPhone Duo's
          vertical bar on the closed display, top trailing elsewhere. */}
      <Stack.Screen
        options={{
          unstable_headerRightItems: () => [
            barButton({
              type: 'button',
              label: 'Done',
              icon: { type: 'sfSymbol', name: 'checkmark' },
              onPress: () => router.back(),
              variant: 'done',
              visibilityPriority: 'high',
            }),
          ],
        }}
      />
      <SectionHeader label="Appearance" />
      <View style={styles.control}>
        <SegmentedControl onChange={setAppearance} options={appearanceOptions} value={appearance} />
      </View>

      <SectionHeader label="Connections" />
      <ListRow
        accessibilityHint="Removes every saved connection from this device"
        dimmed={instances.length === 0}
        onPress={instances.length > 0 ? clearConnections : undefined}
        subtitle={saved}
        title="Remove all connections"
        titleTone="danger"
        variant="flat"
      />

      <SectionHeader label="About" />
      <View accessible style={styles.aboutRow}>
        <Text style={[Type.headline, styles.aboutTitle, { color: colors.text }]}>
          Phoenix Mobile
        </Text>
        <Text style={[Type.mono, { color: colors.textSecondary }]}>
          {Constants.expoConfig?.version ?? '1.0.0'}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { alignSelf: 'center', width: '100%' },
  control: { paddingHorizontal: RowInset, paddingVertical: 8 },
  aboutRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: RowInset,
  },
  aboutTitle: { flex: 1 },
});

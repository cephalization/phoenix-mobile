import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text } from 'react-native';

import type { NativeStackHeaderItemMenu } from 'expo-router/native-stack';

import { offlineInstanceText } from '@/components/offline/offline-state';
import { AppFonts, useAppColors } from '@/constants/theme';
import { NothingSavedOffline, useSavedOfflineDataByInstance } from '@/features/offline/persistence';
import { useReachabilityStore } from '@/features/offline/reachability';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';
import type { PhoenixInstance } from '@/types/instance';

/**
 * The sidebar's title on iOS: the active instance's name as a native menu that
 * switches instances, adds one, or opens Connections. Switching never
 * navigates; the projects list follows the active instance.
 */
export function useInstanceSwitcherItem(
  active: PhoenixInstance | undefined,
): NativeStackHeaderItemMenu | null {
  const instances = useInstanceStore((state) => state.instances);
  const setActiveInstanceId = useInstanceStore((state) => state.setActiveInstanceId);
  const reachability = useReachabilityStore((state) => state.instances);
  const deviceOnline = useReachabilityStore((state) => state.deviceOnline);
  const saved = useSavedOfflineDataByInstance();

  if (!active) return null;

  // Offline, each instance says what it can still show instead of its URL.
  const description = (instance: PhoenixInstance) =>
    deviceOnline && reachability[instance.id]?.state !== 'offline'
      ? instance.baseUrl
      : offlineInstanceText(saved[instance.id] ?? NothingSavedOffline);

  return {
    type: 'menu',
    identifier: 'instance-switcher',
    label: active.name,
    accessibilityLabel: `${active.name}, switch instance`,
    menu: {
      items: [
        {
          type: 'submenu',
          inline: true,
          label: 'Instances',
          items: instances.map((instance) => ({
            type: 'action',
            label: instance.name,
            description: description(instance),
            state: instance.id === active.id ? 'on' : 'off',
            onPress: () => {
              haptics.selection();
              setActiveInstanceId(instance.id);
            },
          })),
        },
        {
          type: 'submenu',
          inline: true,
          label: 'Manage',
          items: [
            {
              type: 'action',
              label: 'Add instance',
              icon: { type: 'sfSymbol', name: 'plus' },
              onPress: () => router.push('/instances/new'),
            },
            {
              type: 'action',
              label: 'Connections',
              icon: { type: 'sfSymbol', name: 'server.rack' },
              onPress: () => router.push('/instances'),
            },
          ],
        },
      ],
    },
  };
}

/** The same switcher for Android: the name opens Connections. */
export function InstanceTitleButton({ instance }: { instance: PhoenixInstance }) {
  const colors = useAppColors();

  return (
    <Pressable
      accessibilityHint="Opens connections"
      accessibilityLabel={`${instance.name}, switch instance`}
      accessibilityRole="button"
      onPress={() => {
        haptics.selection();
        router.push('/instances');
      }}
      style={styles.title}
    >
      <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
        {instance.name}
      </Text>
      <SymbolView
        name={{ android: 'expand_more', ios: 'chevron.down' }}
        size={14}
        tintColor={colors.textSecondary}
        weight="semibold"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { alignItems: 'center', flexDirection: 'row', gap: 6, minHeight: 48 },
  name: { flexShrink: 1, fontFamily: AppFonts.semibold, fontSize: 28, letterSpacing: -0.8 },
});

import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text } from 'react-native';

import type { NativeStackHeaderItemMenu } from 'expo-router/native-stack';

import { AppFonts, useAppColors } from '@/constants/theme';
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

  if (!active) return null;

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
            description: instance.baseUrl,
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

/** The same switcher for Android and web: the name opens Connections. */
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
        name={{ android: 'expand_more', ios: 'chevron.down', web: 'expand_more' }}
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

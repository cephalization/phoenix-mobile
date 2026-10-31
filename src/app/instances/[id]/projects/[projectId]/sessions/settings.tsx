import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MotionPressable } from '@/components/motion-pressable';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow, RowInset, RowSeparator } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { StatusLabel } from '@/components/ui/status-label';
import { AppFonts, Type, useAppColors } from '@/constants/theme';
import { usePhoenixProjectAnnotationConfigs } from '@/hooks/use-phoenix-sessions';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';
import {
  getSessionReviewQueueSettings,
  useSessionReviewSettingsStore,
} from '@/store/session-review-settings';
import { useContentColumnStyle } from '@/features/duo/layout';

export default function SessionQueueSettingsScreen() {
  const { id, projectId } = useLocalSearchParams<{ id: string; projectId: string }>();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  // Pads clear of iPhone Duo's vertical bar, which runs down a sheet's trailing edge.
  const column = useContentColumnStyle(0);
  const instance = useInstanceStore((state) => state.instances.find((item) => item.id === id));
  const queues = useSessionReviewSettingsStore((state) => state.queues);
  const hasHydrated = useSessionReviewSettingsStore((state) => state.hasHydrated);

  const setRequiredConfigNames = useSessionReviewSettingsStore(
    (state) => state.setRequiredConfigNames,
  );

  const settings = getSessionReviewQueueSettings(queues, id, projectId);
  const configs = usePhoenixProjectAnnotationConfigs(instance, projectId);
  const [selectedNames, setSelectedNames] = useState<string[]>(settings.requiredConfigNames);
  const initializedKey = useRef<string | null>(null);

  useEffect(() => {
    const key = JSON.stringify([id, projectId]);

    if (!hasHydrated || initializedKey.current === key) return;
    setSelectedNames(getSessionReviewQueueSettings(queues, id, projectId).requiredConfigNames);
    initializedKey.current = key;
  }, [hasHydrated, id, projectId, queues]);

  const availableNames = new Set(configs.data?.map((config) => config.name) ?? []);
  const staleNames = selectedNames.filter((name) => !availableNames.has(name));

  // ListRow gives the selection haptic.
  const toggle = (name: string) => {
    setSelectedNames((current) =>
      current.includes(name)
        ? current.filter((candidate) => candidate !== name)
        : [...current, name],
    );
  };

  const openNewConfig = () => {
    router.push({
      pathname: '/instances/[id]/projects/[projectId]/sessions/new-annotation-config',
      params: { id, projectId },
    });
  };

  const save = () => {
    setRequiredConfigNames(
      id,
      projectId,
      selectedNames.filter((name) => availableNames.has(name)),
    );
    haptics.success();

    if (router.canGoBack()) router.back();
    else
      router.replace({
        pathname: '/instances/[id]/projects/[projectId]/sessions',
        params: { id, projectId },
      });
  };

  const saveDisabled = !hasHydrated || configs.isPending || configs.isError;

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={[styles.content, column, { paddingBottom: 28 + insets.bottom }]}
      contentInsetAdjustmentBehavior="automatic"
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <Text style={[Type.subhead, styles.inset, { color: colors.textSecondary }]}>
        A session stays in Needs review until every selected annotation has a valid human value.
      </Text>

      {configs.isPending || !hasHydrated ? (
        <EmptyState fill={false} loading title="Loading annotation configurations" />
      ) : configs.isError ? (
        <EmptyState
          action={{ label: 'Try again', onPress: () => void configs.refetch() }}
          fill={false}
          message={configs.error.message}
          symbol={{ ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' }}
          title="Couldn’t load annotation configurations"
        />
      ) : configs.data.length === 0 ? (
        <EmptyState
          action={{ label: 'Create configuration', onPress: openNewConfig }}
          fill={false}
          message="This project has no annotation configurations yet. Create one to start reviewing sessions."
          symbol={{ ios: 'checklist', android: 'checklist', web: 'checklist' }}
          title="No annotation configurations"
        />
      ) : (
        <View>
          <SectionHeader label="Required annotations" />
          {configs.data.map((config, index) => {
            const selected = selectedNames.includes(config.name);
            const kind = formatConfigType(config.type);

            return (
              <View key={config.id}>
                {index > 0 ? <RowSeparator /> : null}
                <ListRow
                  accessibilityLabel={`${config.name}, ${kind.toLowerCase()} annotation, ${selected ? 'required' : 'not required'}`}
                  onPress={() => toggle(config.name)}
                  subtitle={config.description ? `${kind} · ${config.description}` : kind}
                  title={config.name}
                  trailing={
                    selected ? (
                      <SymbolView
                        name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                        size={15}
                        tintColor={colors.text}
                        weight="semibold"
                      />
                    ) : null
                  }
                  variant="flat"
                />
              </View>
            );
          })}
          <RowSeparator />
          <ListRow
            accessibilityHint="Creates and assigns another way to rate sessions"
            leading={
              <SymbolView
                name={{ ios: 'plus', android: 'add', web: 'add' }}
                size={15}
                tintColor={colors.text}
                weight="semibold"
              />
            }
            onPress={openNewConfig}
            title="New configuration"
            variant="flat"
          />
        </View>
      )}

      {staleNames.length > 0 ? (
        <View style={[styles.inset, styles.stale]}>
          <StatusLabel label="Removed configurations" tone="error" />
          <Text style={[Type.subhead, { color: colors.textSecondary }]}>
            {staleNames.join(', ')} no longer exist in this project. Saving removes them from queue
            completion.
          </Text>
        </View>
      ) : null}

      <View style={[styles.inset, styles.actions]}>
        <MotionPressable
          accessibilityRole="button"
          accessibilityState={{ disabled: saveDisabled }}
          disabled={saveDisabled}
          haptic="none"
          onPress={save}
          style={[
            styles.saveButton,
            { backgroundColor: colors.accent, opacity: saveDisabled ? 0.4 : 1 },
          ]}
        >
          <Text style={[styles.saveLabel, { color: colors.accentForeground }]}>Save queue</Text>
        </MotionPressable>
        {Platform.OS === 'web' ? (
          <Text style={[Type.label, styles.webHint, { color: colors.textTertiary }]}>
            Queue settings are stored only on this device.
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

function formatConfigType(type: string) {
  return type.charAt(0) + type.slice(1).toLowerCase();
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { alignSelf: 'center', gap: 4, paddingTop: 12, width: '100%' },
  inset: { paddingHorizontal: RowInset },
  stale: { gap: 4, paddingTop: 16 },
  actions: { gap: 10, paddingTop: 20 },
  saveButton: {
    alignItems: 'center',
    borderRadius: 24,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 22,
  },
  saveLabel: { fontFamily: AppFonts.semibold, fontSize: 15 },
  webHint: { textAlign: 'center' },
});

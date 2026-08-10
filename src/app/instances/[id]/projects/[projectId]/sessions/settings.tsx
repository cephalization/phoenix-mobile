import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MotionPressable } from '@/components/motion-pressable';
import { AppFonts, MaxContentWidth, useAppColors } from '@/constants/theme';
import { usePhoenixProjectAnnotationConfigs } from '@/hooks/use-phoenix-sessions';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';
import {
  getSessionReviewQueueSettings,
  useSessionReviewSettingsStore,
} from '@/store/session-review-settings';

export default function SessionQueueSettingsScreen() {
  const { id, projectId } = useLocalSearchParams<{ id: string; projectId: string }>();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const instance = useInstanceStore((state) => state.instances.find((item) => item.id === id));
  const queues = useSessionReviewSettingsStore((state) => state.queues);
  const hasHydrated = useSessionReviewSettingsStore((state) => state.hasHydrated);
  const setRequiredConfigNames = useSessionReviewSettingsStore((state) => state.setRequiredConfigNames);
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
  const toggle = (name: string) => {
    haptics.selection();
    setSelectedNames((current) => current.includes(name)
      ? current.filter((candidate) => candidate !== name)
      : [...current, name]);
  };
  const openNewConfig = () => {
    router.push({
      pathname: '/instances/[id]/projects/[projectId]/sessions/new-annotation-config',
      params: { id, projectId },
    });
  };
  const save = () => {
    setRequiredConfigNames(id, projectId, selectedNames.filter((name) => availableNames.has(name)));
    haptics.success();
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/instances/[id]/projects/[projectId]/sessions', params: { id, projectId } });
  };

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={[styles.content, { paddingBottom: 28 + insets.bottom }]}
      contentInsetAdjustmentBehavior="automatic"
      style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Review queue' }} />
      <View style={styles.intro}>
        <Text style={[styles.title, { color: colors.text }]}>Define completion</Text>
        <Text style={[styles.copy, { color: colors.textSecondary }]}>
          Select every annotation required to complete a session. A session stays in Needs review until each selected configuration has a valid human annotation.
        </Text>
      </View>

      {configs.isPending || !hasHydrated ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : configs.isError ? (
        <StateCard
          action="Try again"
          message={configs.error.message}
          onPress={() => configs.refetch()}
          title="Couldn’t load annotation configurations"
        />
      ) : configs.data.length === 0 ? (
        <StateCard
          message="This project has no annotation configurations yet. Create one to start reviewing sessions."
          onPress={openNewConfig}
          action="Create configuration"
          secondaryAction="Refresh"
          onSecondaryPress={() => configs.refetch()}
          title="No project annotation configurations"
        />
      ) : (
        <View style={[styles.configList, { borderColor: colors.border }]}>
          {configs.data.map((config, index) => {
            const selected = selectedNames.includes(config.name);
            return (
              <MotionPressable
                accessibilityLabel={`${config.name}, ${config.type.toLowerCase()} annotation`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                key={config.id}
                onPress={() => toggle(config.name)}
                style={[
                  styles.configRow,
                  index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
                ]}>
                <View style={[styles.checkbox, { backgroundColor: selected ? colors.accent : 'transparent', borderColor: selected ? colors.accent : colors.border }]}>
                  <Text style={[styles.check, { color: colors.accentForeground }]}>{selected ? '✓' : ''}</Text>
                </View>
                <View style={styles.configCopy}>
                  <Text style={[styles.configName, { color: colors.text }]}>{config.name}</Text>
                  <Text style={[styles.configType, { color: colors.textSecondary }]}>
                    {formatConfigType(config.type)}{config.description ? ` · ${config.description}` : ''}
                  </Text>
                </View>
              </MotionPressable>
            );
          })}
          <MotionPressable
            accessibilityRole="button"
            onPress={openNewConfig}
            style={[styles.configRow, styles.newConfigRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.newConfigGlyph, { color: colors.textSecondary }]}>＋</Text>
            <View style={styles.configCopy}>
              <Text style={[styles.configName, { color: colors.text }]}>New configuration</Text>
              <Text style={[styles.configType, { color: colors.textSecondary }]}>
                Create and assign another way to rate sessions
              </Text>
            </View>
          </MotionPressable>
        </View>
      )}

      {staleNames.length > 0 ? (
        <View style={[styles.warning, { backgroundColor: colors.backgroundSelected, borderColor: colors.danger }]}>
          <Text style={[styles.warningTitle, { color: colors.danger }]}>Removed configurations</Text>
          <Text style={[styles.copy, { color: colors.textSecondary }]}>
            {staleNames.join(', ')} no longer exist in this project. Saving removes them from queue completion.
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Text style={[styles.selectionCount, { color: colors.textSecondary }]}>
          {selectedNames.filter((name) => availableNames.has(name)).length} selected
        </Text>
        <MotionPressable
          accessibilityRole="button"
          disabled={!hasHydrated || configs.isPending || configs.isError}
          haptic="none"
          onPress={save}
          style={[styles.saveButton, { backgroundColor: colors.accent, opacity: !hasHydrated || configs.isPending || configs.isError ? 0.5 : 1 }]}>
          <Text style={[styles.saveLabel, { color: colors.accentForeground }]}>Save queue</Text>
        </MotionPressable>
      </View>
      {Platform.OS === 'web' ? (
        <Text style={[styles.webHint, { color: colors.textSecondary }]}>Queue settings are stored only on this device.</Text>
      ) : null}
    </ScrollView>
  );
}

function StateCard({ action, message, onPress, onSecondaryPress, secondaryAction, title }: {
  action: string;
  message: string;
  onPress: () => void;
  onSecondaryPress?: () => void;
  secondaryAction?: string;
  title: string;
}) {
  const colors = useAppColors();
  return (
    <View style={[styles.stateCard, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
      <Text style={[styles.stateTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.copy, { color: colors.textSecondary }]}>{message}</Text>
      <View style={styles.stateActions}>
        <MotionPressable accessibilityRole="button" onPress={onPress} style={[styles.secondaryButton, { borderColor: colors.border }]}>
          <Text style={[styles.secondaryLabel, { color: colors.text }]}>{action}</Text>
        </MotionPressable>
        {secondaryAction && onSecondaryPress ? (
          <MotionPressable accessibilityRole="button" onPress={onSecondaryPress} style={[styles.secondaryButton, { borderColor: colors.border }]}>
            <Text style={[styles.secondaryLabel, { color: colors.text }]}>{secondaryAction}</Text>
          </MotionPressable>
        ) : null}
      </View>
    </View>
  );
}

function formatConfigType(type: string) {
  return type.charAt(0) + type.slice(1).toLowerCase();
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { alignSelf: 'center', gap: 20, maxWidth: MaxContentWidth, paddingHorizontal: 20, paddingTop: 18, width: '100%' },
  intro: { gap: 8 },
  title: { fontFamily: AppFonts.semibold, fontSize: 28, letterSpacing: -0.7 },
  copy: { fontFamily: AppFonts.regular, fontSize: 14, lineHeight: 21 },
  loader: { paddingVertical: 48 },
  configList: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  configRow: { alignItems: 'center', flexDirection: 'row', gap: 14, minHeight: 72, paddingHorizontal: 16, paddingVertical: 12 },
  checkbox: { alignItems: 'center', borderRadius: 8, borderWidth: 1.5, height: 28, justifyContent: 'center', width: 28 },
  check: { fontFamily: AppFonts.semibold, fontSize: 16 },
  configCopy: { flex: 1, gap: 3 },
  configName: { fontFamily: AppFonts.semibold, fontSize: 15 },
  configType: { fontFamily: AppFonts.regular, fontSize: 12, lineHeight: 17 },
  newConfigRow: { borderTopWidth: StyleSheet.hairlineWidth, minHeight: 60 },
  newConfigGlyph: { fontFamily: AppFonts.semibold, fontSize: 18, textAlign: 'center', width: 28 },
  stateActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  warning: { borderLeftWidth: 3, borderRadius: 12, gap: 5, padding: 14 },
  warningTitle: { fontFamily: AppFonts.semibold, fontSize: 14 },
  stateCard: { alignItems: 'flex-start', borderRadius: 18, borderWidth: 1, gap: 8, padding: 18 },
  stateTitle: { fontFamily: AppFonts.semibold, fontSize: 17 },
  secondaryButton: { borderRadius: 14, borderWidth: 1, justifyContent: 'center', marginTop: 5, minHeight: 48, paddingHorizontal: 16 },
  secondaryLabel: { fontFamily: AppFonts.semibold, fontSize: 14 },
  actions: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between', paddingTop: 4 },
  selectionCount: { fontFamily: AppFonts.medium, fontSize: 13 },
  saveButton: { alignItems: 'center', borderRadius: 16, justifyContent: 'center', minHeight: 50, paddingHorizontal: 22 },
  saveLabel: { fontFamily: AppFonts.semibold, fontSize: 15 },
  webHint: { fontFamily: AppFonts.regular, fontSize: 12, textAlign: 'center' },
});

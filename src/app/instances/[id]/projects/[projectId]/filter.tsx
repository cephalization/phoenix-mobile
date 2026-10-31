import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { barButton } from '@/components/duo/column-header';
import { MotionPressable } from '@/components/motion-pressable';
import { TraceFilterAsk, useTraceFilterAsk } from '@/components/traces/trace-filter-ask';
import { TraceFilterEditor } from '@/components/traces/trace-filter-editor';
import { ListRow, RowInset } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { AppFonts, useAppColors } from '@/constants/theme';
import { useContentColumnStyle } from '@/features/duo/layout';
import { normalizeTraceFilter } from '@/features/traces/filter';
import { useTraceFilterAssistant } from '@/features/traces/filter-models';
import { traceRangePreset } from '@/features/traces/range';
import { useTraceFilterValidation, useTraceFilterVocabulary } from '@/hooks/use-phoenix-data';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';
import { useSettingsStore } from '@/store/settings';
import { traceFilterKey, useTraceFilterStore } from '@/store/trace-filters';

type FilterMode = 'expression' | 'ask';

const Modes = [
  { label: 'Expression', value: 'expression' },
  { label: 'Ask', value: 'ask' },
] as const satisfies readonly { label: string; value: FilterMode }[];

const EmptyRecent: readonly string[] = [];

/**
 * Edits the Traces list's filter: an expression with server validation,
 * recent filters, suggestions, and field completion, or a plain-language
 * request a model turns into one. Apply in the bar commits it.
 */
export default function TraceFilterScreen() {
  const { id, projectId } = useLocalSearchParams<{ id: string; projectId: string }>();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  // Pads clear of iPhone Duo's vertical bar, which runs down a sheet's trailing edge.
  const column = useContentColumnStyle(0);
  const instance = useInstanceStore((state) => state.instances.find((item) => item.id === id));
  const key = traceFilterKey(id, projectId);
  const activeExpression = useTraceFilterStore((state) => state.active[key] ?? null);
  const recent = useTraceFilterStore((state) => state.recent[key] ?? EmptyRecent);
  const applyFilter = useTraceFilterStore((state) => state.applyFilter);
  const clearFilter = useTraceFilterStore((state) => state.clearFilter);
  const preset = useSettingsStore((state) => state.traceRangePreset);
  const [mode, setMode] = useState<FilterMode>('expression');
  const [draft, setDraft] = useState(activeExpression ?? '');

  // Observed names come from the list's range preset; one cache entry per
  // preset keeps reopening the sheet from refetching.
  const [rangeEnd] = useState(() => Date.now());

  const vocabulary = useTraceFilterVocabulary(instance, projectId, {
    cacheKey: preset,
    endTime: new Date(rangeEnd).toISOString(),
    startTime: new Date(rangeEnd - traceRangePreset(preset).durationMs).toISOString(),
  });

  const terms = vocabulary.data ?? [];
  const validation = useTraceFilterValidation(instance, projectId, draft);
  const assistant = useTraceFilterAssistant(instance);
  const ask = useTraceFilterAsk({ assistant, instance, projectId, vocabulary: terms });
  const asking = mode === 'ask' && assistant !== null;
  const normalizedDraft = normalizeTraceFilter(draft);

  const draftApplicable =
    normalizedDraft.length === 0
      ? activeExpression !== null
      : validation.state === 'valid' || validation.state === 'unavailable';

  const pending = asking ? ask.applicable : draftApplicable ? normalizedDraft : null;

  const close = () => {
    if (router.canGoBack()) router.back();
    else
      router.replace({
        pathname: '/instances/[id]/projects/[projectId]',
        params: { id, projectId, view: 'traces' },
      });
  };

  const apply = (expression: string) => {
    applyFilter(key, expression);
    haptics.success();
    close();
  };

  const clear = () => {
    clearFilter(key);
    haptics.success();
    close();
  };

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={[styles.content, column, { paddingBottom: 28 + insets.bottom }]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <Stack.Screen
        options={{
          unstable_headerRightItems: () => [
            barButton({
              type: 'button',
              label: 'Apply',
              icon: { type: 'sfSymbol', name: 'checkmark' },
              disabled: pending === null,
              onPress: () => {
                if (pending !== null) apply(pending);
              },
              variant: 'done',
              visibilityPriority: 'high',
            }),
          ],
        }}
      />

      {assistant ? (
        <View style={styles.modes}>
          <SegmentedControl onChange={setMode} options={Modes} value={mode} />
        </View>
      ) : null}

      <View style={asking && styles.hidden}>
        <TraceFilterEditor
          draft={draft}
          onChangeDraft={setDraft}
          onSubmit={() => {
            if (draftApplicable) apply(normalizedDraft);
          }}
          recent={recent}
          validation={validation}
          vocabulary={terms}
        />
      </View>

      {assistant ? (
        <View style={!asking && styles.hidden}>
          <TraceFilterAsk
            ask={ask}
            assistant={assistant}
            onEdit={(expression) => {
              setDraft(expression);
              setMode('expression');
            }}
            onUse={apply}
          />
        </View>
      ) : null}

      {activeExpression !== null ? (
        <View>
          <SectionHeader label="Applied" />
          <ListRow
            accessibilityHint="Shows every trace again"
            onPress={clear}
            subtitle={activeExpression}
            subtitleMono
            title="Clear filter"
            titleTone="danger"
            variant="flat"
          />
        </View>
      ) : null}

      {/* Android and web have no native bar item for the sheet's action. */}
      {Platform.OS === 'ios' ? null : (
        <View style={styles.actions}>
          <MotionPressable
            accessibilityRole="button"
            accessibilityState={{ disabled: pending === null }}
            disabled={pending === null}
            onPress={() => {
              if (pending !== null) apply(pending);
            }}
            style={[
              styles.applyButton,
              { backgroundColor: colors.accent, opacity: pending === null ? 0.4 : 1 },
            ]}
          >
            <Text style={[styles.applyLabel, { color: colors.accentForeground }]}>
              Apply filter
            </Text>
          </MotionPressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { alignSelf: 'center', width: '100%' },
  modes: { paddingHorizontal: RowInset, paddingTop: 12 },
  hidden: { display: 'none' },
  actions: { paddingHorizontal: RowInset, paddingTop: 24 },
  applyButton: {
    alignItems: 'center',
    borderRadius: 24,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 22,
  },
  applyLabel: { fontFamily: AppFonts.semibold, fontSize: 15 },
});

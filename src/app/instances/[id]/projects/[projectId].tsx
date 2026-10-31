import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { NativeStackHeaderItemMenu } from 'expo-router/native-stack';

import { DuoArrangement, useArrangementPane } from '@/components/duo/arrangement';
import { ContentColumn } from '@/components/duo/content-column';
import { usePxiHeaderOptions } from '@/components/pxi-header-button';
import { TraceDetailView } from '@/components/traces/trace-detail';
import { InlineChoice, ProjectViewPicker } from '@/components/traces/project-list-header';
import { TraceRow } from '@/components/traces/trace-row';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionHeader } from '@/components/ui/section-header';
import { StatStrip } from '@/components/ui/stat-strip';
import { Type, useAppColors } from '@/constants/theme';
import { nativeHeaderTitle, useDuoLayout } from '@/features/duo/layout';
import { isSplitDetail, useSplitDetail } from '@/features/duo/split-detail';
import { selectDetail } from '@/features/duo/split-routes';
import {
  createTraceRange,
  DefaultTraceView,
  traceFilterLabel,
  TraceFilters,
  traceRangePreset,
  TraceRangePresets,
  type TraceRangeSelection,
} from '@/features/traces/range';
import {
  type PhoenixTraceFilter,
  type PhoenixTraceSummary,
  usePhoenixProjects,
  usePhoenixProjectTraceSummary,
  usePhoenixProjectTraces,
} from '@/hooks/use-phoenix-data';
import { formatCompactNumber, formatDuration } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';
import { type TraceRangePreset, useSettingsStore } from '@/store/settings';

/** Primary share of the regular-width split: the feed leads, the trace detail takes the rest. */
const SplitRatio = 0.44;

const StreamingOptions = [
  { label: 'Paused', value: 'paused' },
  { label: 'Streaming', value: 'streaming' },
] as const;

/**
 * The project's Traces list. The time range, streaming, and the
 * Recent/Errors/Slowest filter live in one bar menu on iOS and in a line of
 * choices above the list elsewhere.
 */
export default function ProjectTracesScreen() {
  const { id, projectId } = useLocalSearchParams<{ id: string; projectId: string }>();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { isRegularWidth, systemBarEdge } = useDuoLayout();
  const splitDetail = useSplitDetail();
  const nativeBar = Platform.OS === 'ios';
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [filter, setFilter] = useState<PhoenixTraceFilter>(DefaultTraceView.filter);

  const [range, setRange] = useState<TraceRangeSelection>(() =>
    createTraceRange(useSettingsStore.getState().traceRangePreset),
  );

  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [screenFocused, setScreenFocused] = useState(true);
  const [appState, setAppState] = useState(AppState.currentState);
  const [pollTick, setPollTick] = useState(0);
  const streaming = useSettingsStore((state) => state.traceStreaming);
  const setTraceRangePreset = useSettingsStore((state) => state.setTraceRangePreset);
  const setStreaming = useSettingsStore((state) => state.setTraceStreaming);

  const instance = useInstanceStore((state) =>
    state.instances.find((candidate) => candidate.id === id),
  );

  const projects = usePhoenixProjects(instance);
  const project = projects.data?.find((candidate) => candidate.id === projectId);
  const summary = usePhoenixProjectTraceSummary(instance, projectId, range);
  const activeTraces = usePhoenixProjectTraces(instance, projectId, filter, range);
  const traces = activeTraces.data?.pages.flatMap((page) => page.items) ?? [];
  const firstTraceId = traces[0]?.traceId ?? null;

  // Latch the first loaded trace into the split during render (React's derived-state pattern)
  // so streaming updates do not move the detail pane until the user picks another trace.
  if (isRegularWidth && selectedTraceId === null && firstTraceId !== null) {
    setSelectedTraceId(firstTraceId);
  }

  const selectedInList = traces.some((trace) => trace.traceId === selectedTraceId);

  // The detail pane shows the chosen trace while it is listed, falls back to the newest
  // trace when a filter or range change drops it, and keeps it while the list is empty.
  const activeTraceId = selectedInList || firstTraceId === null ? selectedTraceId : firstTraceId;

  // PXI takes the detail pane's place, so the trace it showed moves onto the
  // stack and the feed becomes a single screen again.
  const pxiHeader = usePxiHeaderOptions(instance, () => {
    if (!isRegularWidth || !instance || activeTraceId === null) return;

    router.push({
      pathname: '/instances/[id]/projects/[projectId]/traces/[traceId]',
      params: { id: instance.id, projectId, traceId: activeTraceId },
    });
  });

  const dataRefreshing =
    (activeTraces.isRefetching && !activeTraces.isFetchingNextPage) || summary.isRefetching;

  const pollRange = useEffectEvent(() => {
    if (dataRefreshing) return;
    setRange((current) => createTraceRange(current.preset, current.cacheKey));
    setPollTick((current) => current + 1);
  });

  const refetchPolledRange = useEffectEvent(() => {
    void Promise.all([activeTraces.refetch(), summary.refetch()]);
  });

  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);

      return () => setScreenFocused(false);
    }, []),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!streaming || !screenFocused || appState !== 'active') return;
    const initialPoll = setTimeout(pollRange, 0);
    const interval = setInterval(pollRange, 10_000);

    return () => {
      clearTimeout(initialPoll);
      clearInterval(interval);
    };
  }, [appState, screenFocused, streaming]);

  useEffect(() => {
    if (pollTick > 0) refetchPolledRange();
  }, [pollTick]);

  if (!instance) {
    return (
      <UnavailableState
        message="This Phoenix connection is no longer on this device."
        title="Instance not found"
      />
    );
  }

  if (projects.isSuccess && !project) {
    return (
      <UnavailableState
        message="This project is no longer available on the connected instance."
        title="Project not found"
      />
    );
  }

  const refresh = async () => {
    if (dataRefreshing || manualRefreshing) return;
    haptics.selection();
    setManualRefreshing(true);

    try {
      const results = await Promise.all([activeTraces.refetch(), summary.refetch()]);

      if (results.some((result) => result.isError)) haptics.error();
      else haptics.light();
    } finally {
      setManualRefreshing(false);
    }
  };

  const changeRange = (preset: TraceRangePreset) => {
    if (preset === range.preset) return;
    haptics.selection();
    setTraceRangePreset(preset);
    setRange(createTraceRange(preset));
  };

  const changeFilter = (next: PhoenixTraceFilter) => {
    if (next === filter) return;
    haptics.selection();
    setFilter(next);
  };

  const changeStreaming = (value: boolean) => {
    haptics.selection();
    setStreaming(value);
  };

  const rangeLabel = traceRangePreset(range.preset).label;
  const filterLabel = traceFilterLabel(filter);

  const viewChanged =
    range.preset !== DefaultTraceView.preset ||
    filter !== DefaultTraceView.filter ||
    streaming !== DefaultTraceView.streaming;

  const viewMenu: NativeStackHeaderItemMenu = {
    type: 'menu',
    identifier: 'trace-view',
    label: 'Time range and filter',
    accessibilityLabel: `Time range and filter, ${rangeLabel}, ${filterLabel}, ${streaming ? 'streaming' : 'paused'}`,
    icon: {
      type: 'sfSymbol',
      name: viewChanged
        ? 'line.3.horizontal.decrease.circle.fill'
        : 'line.3.horizontal.decrease.circle',
    },
    menu: {
      items: [
        {
          type: 'submenu',
          inline: true,
          label: 'Time range',
          items: TraceRangePresets.map((option) => ({
            type: 'action',
            label: option.label,
            state: option.value === range.preset ? 'on' : 'off',
            onPress: () => changeRange(option.value),
          })),
        },
        {
          type: 'action',
          label: 'Streaming',
          description: 'Refreshes every 10 seconds',
          icon: { type: 'sfSymbol', name: 'dot.radiowaves.left.and.right' },
          state: streaming ? 'on' : 'off',
          onPress: () => changeStreaming(!streaming),
        },
        {
          type: 'submenu',
          inline: true,
          label: 'Show',
          items: TraceFilters.map((option) => ({
            type: 'action',
            label: option.label,
            state: option.value === filter ? 'on' : 'off',
            onPress: () => changeFilter(option.value),
          })),
        },
      ],
    },
  };

  const sectionLabel = [
    rangeLabel,
    filter === 'recent' ? null : filterLabel,
    streaming ? 'Live' : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');

  const feed = (
    <ContentColumn padding={0}>
      {(column) => (
        <FlatList
          extraData={activeTraceId}
          contentContainerStyle={[styles.content, column, { paddingBottom: 24 + insets.bottom }]}
          contentInsetAdjustmentBehavior="automatic"
          data={traces}
          initialNumToRender={12}
          keyExtractor={(trace) => trace.id}
          ListEmptyComponent={
            activeTraces.isPending ? (
              <EmptyState loading title="Loading traces" />
            ) : activeTraces.isError ? (
              <EmptyState
                action={{ label: 'Try again', onPress: () => void activeTraces.refetch() }}
                message={activeTraces.error.message}
                symbol={{
                  android: 'error',
                  ios: 'exclamationmark.triangle',
                  web: 'error',
                }}
                title="Couldn’t load traces"
              />
            ) : (
              <EmptyState
                message={
                  filter === 'errors'
                    ? 'No root spans with an error status in this range.'
                    : 'New traces appear here as this project receives activity.'
                }
                symbol={{ android: 'inbox', ios: 'tray', web: 'inbox' }}
                title={filter === 'errors' ? 'No error traces' : 'No traces yet'}
              />
            )
          }
          ListFooterComponent={
            activeTraces.isFetchingNextPage ? (
              <ActivityIndicator color={colors.textSecondary} style={styles.footer} />
            ) : traces.length > 0 && !activeTraces.hasNextPage ? (
              <Text style={[Type.subhead, styles.listEnd, { color: colors.textTertiary }]}>
                All traces in range loaded
              </Text>
            ) : undefined
          }
          ListHeaderComponent={
            <View>
              <ProjectViewPicker
                instanceId={instance.id}
                projectId={projectId}
                title={project?.name}
                value="traces"
              />
              {nativeBar ? null : (
                <View>
                  <InlineChoice
                    label="Range"
                    onChange={changeRange}
                    options={TraceRangePresets.map((option) => ({
                      label: option.shortLabel,
                      value: option.value,
                    }))}
                    value={range.preset}
                  />
                  <InlineChoice
                    label="Show"
                    onChange={changeFilter}
                    options={TraceFilters}
                    value={filter}
                  />
                  <InlineChoice
                    label="Updates"
                    onChange={(value) => changeStreaming(value === 'streaming')}
                    options={StreamingOptions}
                    value={streaming ? 'streaming' : 'paused'}
                  />
                </View>
              )}
              <TraceStats isLoading={summary.isPending} summary={summary.data} />
              <SectionHeader label={sectionLabel} />
            </View>
          }
          maxToRenderPerBatch={12}
          onEndReached={() => {
            if (activeTraces.hasNextPage && !activeTraces.isFetchingNextPage)
              activeTraces.fetchNextPage();
          }}
          onEndReachedThreshold={0.35}
          refreshControl={
            <RefreshControl
              colors={[colors.textSecondary]}
              onRefresh={refresh}
              progressBackgroundColor={colors.backgroundElement}
              refreshing={manualRefreshing}
              tintColor={colors.textSecondary}
            />
          }
          removeClippedSubviews={Platform.OS === 'android'}
          renderItem={({ item }) => (
            <TraceRow
              onPress={() => {
                if (isRegularWidth) {
                  setSelectedTraceId(item.traceId);

                  return;
                }

                selectDetail({
                  pathname: '/instances/[id]/projects/[projectId]/traces/[traceId]',
                  params: { id: instance.id, projectId, traceId: item.traceId },
                });
              }}
              selected={
                isRegularWidth
                  ? item.traceId === activeTraceId
                  : isSplitDetail(
                      splitDetail,
                      'instances/[id]/projects/[projectId]/traces/[traceId]',
                      'traceId',
                      item.traceId,
                    )
              }
              trace={item}
            />
          )}
          style={styles.list}
          windowSize={7}
        />
      )}
    </ContentColumn>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerBackTitle: instance.name,
          scrollEdgeEffects: { bottom: 'soft' },
          title: nativeHeaderTitle(systemBarEdge, project?.name ?? 'Project'),
          headerRight: nativeBar ? undefined : pxiHeader.headerRight,
          // PXI comes last, which puts it at the top of a vertical bar.
          unstable_headerRightItems: nativeBar
            ? (props) => [viewMenu, ...(pxiHeader.unstable_headerRightItems?.(props) ?? [])]
            : undefined,
        }}
      />
      {isRegularWidth ? (
        <DuoArrangement
          preferredAxis="horizontal"
          primary={feed}
          ratio={SplitRatio}
          secondary={
            <TraceDetailPane
              instanceId={instance.id}
              projectId={projectId}
              traceId={activeTraceId}
            />
          }
        />
      ) : (
        feed
      )}
    </View>
  );
}

function TraceStats({
  isLoading,
  summary,
}: {
  isLoading: boolean;
  summary: PhoenixTraceSummary | undefined;
}) {
  const ready = !isLoading && summary !== undefined;
  const errors = ready ? summary.errorCount : 0;

  return (
    <StatStrip
      stats={[
        { label: 'Traces', value: ready ? formatCompactNumber(summary.traceCount) : '—' },
        {
          label: 'Errors',
          value: ready ? formatCompactNumber(errors) : '—',
          tone: errors > 0 ? 'danger' : 'default',
        },
        {
          label: 'p50',
          value:
            ready && summary.medianLatencyMs !== null
              ? formatDuration(summary.medianLatencyMs)
              : '—',
        },
        {
          label: 'Tokens',
          value:
            ready && summary.tokenCountTotal !== null
              ? formatCompactNumber(summary.tokenCountTotal)
              : '—',
        },
      ]}
    />
  );
}

function TraceDetailPane({
  instanceId,
  projectId,
  traceId,
}: {
  instanceId: string;
  projectId: string;
  traceId: string | null;
}) {
  const colors = useAppColors();
  const pane = useArrangementPane();

  // A flat split has no gutter, so draw a hairline on the pane's leading edge; the fold
  // supplies its own separation when the device is partially folded.
  const divider =
    pane === null || pane.isFolded
      ? null
      : pane.axis === 'horizontal'
        ? { borderLeftColor: colors.separator, borderLeftWidth: StyleSheet.hairlineWidth }
        : pane.axis === 'vertical'
          ? { borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth }
          : null;

  return (
    <View style={[styles.detailPane, { backgroundColor: colors.background }, divider]}>
      {traceId === null ? (
        <EmptyState
          message="Trace details appear here as you move through the list."
          symbol={{ android: 'timeline', ios: 'list.bullet.indent', web: 'timeline' }}
          title="Select a trace"
        />
      ) : (
        <TraceDetailView
          embedded
          instanceId={instanceId}
          key={traceId}
          projectId={projectId}
          traceId={traceId}
        />
      )}
    </View>
  );
}

function UnavailableState({ message, title }: { message: string; title: string }) {
  const colors = useAppColors();

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Project' }} />
      <EmptyState
        action={{
          label: 'Go back',
          onPress: () => {
            if (router.canGoBack()) router.back();
            else router.replace('/');
          },
        }}
        message={message}
        title={title}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { flex: 1 },
  detailPane: { flex: 1, justifyContent: 'center' },
  content: { alignSelf: 'center', flexGrow: 1, width: '100%' },
  footer: { paddingVertical: 24 },
  listEnd: { paddingVertical: 24, textAlign: 'center' },
});

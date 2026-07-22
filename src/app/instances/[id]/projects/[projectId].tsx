import { Host, Slider, Switch } from '@expo/ui';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { MotionPressable } from '@/components/motion-pressable';
import { PxiHeaderButton } from '@/components/pxi-header-button';
import { AppFonts, MaxContentWidth, Spacing, useAppColors } from '@/constants/theme';
import {
  type PhoenixTraceFilter,
  type PhoenixTraceListItem,
  type PhoenixTraceRange,
  type PhoenixTraceSummary,
  usePhoenixProjects,
  usePhoenixProjectTraceSummary,
  usePhoenixProjectTraces,
} from '@/hooks/use-phoenix-data';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';
import { type TraceRangePreset, useSettingsStore } from '@/store/settings';

const FILTERS: { label: string; value: PhoenixTraceFilter }[] = [
  { label: 'Recent', value: 'recent' },
  { label: 'Errors', value: 'errors' },
  { label: 'Slowest', value: 'slowest' },
];

type TraceRangeSelection = PhoenixTraceRange & {
  preset: TraceRangePreset;
};

const RANGE_PRESETS: { durationMs: number; label: string; shortLabel: string; value: TraceRangePreset }[] = [
  { durationMs: 60 * 60 * 1000, label: 'Last hour', shortLabel: '1h', value: 'hour' },
  { durationMs: 24 * 60 * 60 * 1000, label: 'Last 24 hours', shortLabel: '24h', value: 'day' },
  { durationMs: 7 * 24 * 60 * 60 * 1000, label: 'Last 7 days', shortLabel: '7d', value: 'week' },
  { durationMs: 30 * 24 * 60 * 60 * 1000, label: 'Last 30 days', shortLabel: '30d', value: 'month' },
];

export default function ProjectTracesScreen() {
  const { id, projectId } = useLocalSearchParams<{ id: string; projectId: string }>();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWide = width >= 700;
  const [filter, setFilter] = useState<PhoenixTraceFilter>('recent');
  const [range, setRange] = useState<TraceRangeSelection>(() =>
    createTraceRange(useSettingsStore.getState().traceRangePreset)
  );
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [screenFocused, setScreenFocused] = useState(true);
  const [appState, setAppState] = useState(AppState.currentState);
  const [pollTick, setPollTick] = useState(0);
  const streaming = useSettingsStore((state) => state.traceStreaming);
  const setTraceRangePreset = useSettingsStore((state) => state.setTraceRangePreset);
  const setStreaming = useSettingsStore((state) => state.setTraceStreaming);
  const instance = useInstanceStore((state) => state.instances.find((candidate) => candidate.id === id));
  const projects = usePhoenixProjects(instance);
  const project = projects.data?.find((candidate) => candidate.id === projectId);
  const summary = usePhoenixProjectTraceSummary(instance, projectId, range);
  const activeTraces = usePhoenixProjectTraces(instance, projectId, filter, range);
  const traces = activeTraces.data?.pages.flatMap((page) => page.items) ?? [];
  const dataRefreshing = (activeTraces.isRefetching && !activeTraces.isFetchingNextPage) || summary.isRefetching;
  const pollRange = useEffectEvent(() => {
    if (dataRefreshing) return;
    setRange((current) => createTraceRange(current.preset, current.cacheKey));
    setPollTick((current) => current + 1);
  });
  const refetchPolledRange = useEffectEvent(() => {
    void Promise.all([activeTraces.refetch(), summary.refetch()]);
  });

  useFocusEffect(useCallback(() => {
    setScreenFocused(true);
    return () => setScreenFocused(false);
  }, []));

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
    return <UnavailableState message="This Phoenix connection is no longer on this device." title="Instance not found" />;
  }

  if (projects.isSuccess && !project) {
    return <UnavailableState message="This project is no longer available on the connected instance." title="Project not found" />;
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

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerBackTitle: instance?.name ?? 'Instance',
          headerRight: () => <PxiHeaderButton instance={instance} />,
          scrollEdgeEffects: { bottom: 'soft' },
          title: project?.name ?? 'Project',
          unstable_headerRightItems: () => [
            {
              element: <PxiHeaderButton instance={instance} />,
              type: 'custom',
            },
          ],
        }}
      />
      <FlatList
        contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}
        contentInsetAdjustmentBehavior="automatic"
        data={traces}
        initialNumToRender={12}
        keyExtractor={(trace) => trace.id}
        ListEmptyComponent={
          <TraceListState
            filter={filter}
            isError={activeTraces.isError}
            isPending={activeTraces.isPending}
            message={activeTraces.error?.message}
            retry={() => activeTraces.refetch()}
          />
        }
        ListFooterComponent={
          activeTraces.isFetchingNextPage ? (
            <ActivityIndicator color={colors.accent} style={styles.footerLoader} />
          ) : traces.length > 0 ? (
            <Text style={[styles.listEnd, { color: colors.textSecondary }]}>All available traces loaded</Text>
          ) : null
        }
        ListHeaderComponent={
          <View style={styles.headerContent}>
            <View style={styles.projectIntro}>
              <Text numberOfLines={2} style={[styles.title, { color: colors.text }]}>{project?.name ?? 'Project traces'}</Text>
              {project?.description ? (
                <Text style={[styles.description, { color: colors.textSecondary }]}>{project.description}</Text>
              ) : (
                <Text style={[styles.description, { color: colors.textSecondary }]}>Recent activity and performance at a glance.</Text>
              )}
            </View>

            <TraceRangeSelector
              onChange={(preset) => {
                if (preset === range.preset) return;
                haptics.selection();
                setTraceRangePreset(preset);
                setRange(createTraceRange(preset));
              }}
              range={range}
              streaming={streaming}
              onStreamingChange={(value) => {
                haptics.selection();
                setStreaming(value);
              }}
            />
            <TraceSummary isLoading={summary.isPending} isWide={isWide} summary={summary.data} />

            <View style={styles.traceHeading}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Traces</Text>
            </View>
            <ScrollView
              contentContainerStyle={styles.filters}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterScroller}>
              {FILTERS.map((option) => {
                const selected = option.value === filter;
                return (
                  <MotionPressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    haptic={selected ? 'none' : 'selection'}
                    key={option.value}
                    onPress={() => setFilter(option.value)}
                    style={[
                      styles.filter,
                      {
                        backgroundColor: selected ? colors.accent : colors.backgroundSelected,
                        borderColor: selected ? colors.accent : colors.border,
                      },
                    ]}>
                    <Text style={[styles.filterLabel, { color: selected ? colors.accentForeground : colors.text }]}>
                      {option.label}
                    </Text>
                  </MotionPressable>
                );
              })}
            </ScrollView>
            {isWide && traces.length > 0 ? <TraceTableHeader /> : null}
          </View>
        }
        maxToRenderPerBatch={12}
        onEndReached={() => {
          if (activeTraces.hasNextPage && !activeTraces.isFetchingNextPage) activeTraces.fetchNextPage();
        }}
        onEndReachedThreshold={0.35}
        refreshControl={
          <RefreshControl
            colors={[colors.brand]}
            onRefresh={refresh}
            progressBackgroundColor={colors.backgroundElement}
            refreshing={manualRefreshing}
            tintColor={colors.brand}
          />
        }
        removeClippedSubviews={Platform.OS === 'android'}
        renderItem={({ item }) => (
          <TraceRow
            isWide={isWide}
            onPress={() => router.push({
              pathname: '/instances/[id]/projects/[projectId]/traces/[traceId]',
              params: { id: instance.id, projectId, traceId: item.traceId },
            })}
            trace={item}
          />
        )}
        style={styles.list}
        windowSize={7}
      />
    </View>
  );
}

function UnavailableState({ message, title }: { message: string; title: string }) {
  const colors = useAppColors();
  return (
    <View style={[styles.unavailableScreen, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Project' }} />
      <Text style={[styles.stateTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.stateCopy, { color: colors.textSecondary }]}>{message}</Text>
      <MotionPressable
        accessibilityRole="button"
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace('/');
        }}
        style={[styles.retryButton, { backgroundColor: colors.accent }]}>
        <Text style={[styles.retryLabel, { color: colors.accentForeground }]}>Go back</Text>
      </MotionPressable>
    </View>
  );
}

function TraceSummary({
  isLoading,
  isWide,
  summary,
}: {
  isLoading: boolean;
  isWide: boolean;
  summary: PhoenixTraceSummary | undefined;
}) {
  const colors = useAppColors();
  const metrics = [
    { label: 'Traces', value: summary ? formatCompactNumber(summary.traceCount) : '—' },
    { label: 'Errors', value: summary && summary.traceCount > 0 ? `${Math.round((summary.errorCount / summary.traceCount) * 100)}%` : '—' },
    { label: 'Median', value: summary?.medianLatencyMs == null ? '—' : formatDuration(summary.medianLatencyMs) },
    { label: 'Tokens', value: summary?.tokenCountTotal == null ? '—' : formatCompactNumber(summary.tokenCountTotal) },
  ];

  return (
    <View style={[styles.summary, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
      {metrics.map((metric, index) => (
        <View
          key={metric.label}
          style={[
            styles.metric,
            { flexBasis: isWide ? '25%' : '50%' },
            index > 0 && (isWide || index % 2 === 1) && { borderLeftColor: colors.border, borderLeftWidth: 1 },
            !isWide && index > 1 && { borderTopColor: colors.border, borderTopWidth: 1 },
          ]}>
          <Text numberOfLines={1} style={[styles.metricLabel, { color: colors.textSecondary }]}>{metric.label}</Text>
          {isLoading ? (
            <ActivityIndicator color={colors.accent} size="small" style={styles.metricLoader} />
          ) : (
            <Text numberOfLines={1} style={[styles.metricValue, { color: colors.text }]}>{metric.value}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

function TraceRangeSelector({
  onChange,
  onStreamingChange,
  range,
  streaming,
}: {
  onChange: (preset: TraceRangePreset) => void;
  onStreamingChange: (value: boolean) => void;
  range: TraceRangeSelection;
  streaming: boolean;
}) {
  const colors = useAppColors();
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [controlsHeight, setControlsHeight] = useState(220);
  const expansion = useSharedValue(0);
  const selectedIndex = RANGE_PRESETS.findIndex((option) => option.value === range.preset);
  const selected = RANGE_PRESETS[selectedIndex];
  const streamingLabel = streaming ? 'Streaming' : 'Paused';
  const controlsStyle = useAnimatedStyle(() => ({
    height: controlsHeight * expansion.get(),
    opacity: expansion.get(),
  }));
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${expansion.get() * 90}deg` }],
  }));
  const toggleExpanded = () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    expansion.set(withTiming(nextExpanded ? 1 : 0, {
      duration: reduceMotion ? 0 : 220,
      easing: Easing.out(Easing.cubic),
    }));
  };

  return (
    <View style={[styles.rangeDisclosure, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
      <MotionPressable
        accessibilityLabel={`Time range, ${selected.label}, ${streamingLabel}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        haptic="selection"
        onPress={toggleExpanded}
        style={styles.rangeSummaryRow}>
        <View style={styles.rangeSummaryCopy}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>Time range</Text>
          <View style={styles.rangeSummaryState}>
            <View style={[styles.streamingDot, { backgroundColor: streaming ? colors.brandSecondary : colors.textSecondary }]} />
            <Text numberOfLines={1} style={[styles.rangeSummaryValue, { color: colors.text }]}>
              {selected.label} · {streamingLabel}
            </Text>
          </View>
        </View>
        <Animated.View style={chevronStyle}>
          <SymbolView
            accessibilityElementsHidden
            name={{ android: 'chevron_right', ios: 'chevron.right', web: 'chevron_right' }}
            size={17}
            tintColor={colors.textSecondary}
            weight="semibold"
          />
        </Animated.View>
      </MotionPressable>

      <Animated.View
        accessibilityElementsHidden={!expanded}
        importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
        pointerEvents={expanded ? 'auto' : 'none'}
        style={[styles.rangeControlsClip, controlsStyle]}>
        <View
          onLayout={({ nativeEvent }) => {
            if (nativeEvent.layout.height > 0) setControlsHeight(nativeEvent.layout.height);
          }}
          style={[styles.rangeControls, { borderTopColor: colors.border }]}>
          <View style={styles.rangeControl}>
            <Host ignoreSafeArea="all" seedColor={colors.brand} style={styles.sliderHost}>
              <Slider
                max={RANGE_PRESETS.length - 1}
                min={0}
                onValueChange={(value) => onChange(RANGE_PRESETS[Math.round(value)].value)}
                step={1}
                value={selectedIndex}
              />
            </Host>
            <View style={styles.rangeLabels}>
              {RANGE_PRESETS.map((option) => {
                const isSelected = option.value === range.preset;
                return (
                  <MotionPressable
                    accessibilityLabel={option.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    haptic="none"
                    key={option.value}
                    onPress={() => onChange(option.value)}
                    style={styles.rangeLabelButton}>
                    <Text style={[styles.rangeLabel, { color: isSelected ? colors.text : colors.textSecondary }]}>
                      {option.shortLabel}
                    </Text>
                  </MotionPressable>
                );
              })}
            </View>
            <Text style={[styles.rangeDates, { color: colors.textSecondary }]}>{formatRange(range)}</Text>
          </View>
          <View style={[styles.streamingRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.streamingLabel, { color: colors.text }]}>Streaming</Text>
            <Host ignoreSafeArea="all" matchContents seedColor={colors.brand}>
              <Switch onValueChange={onStreamingChange} value={streaming} />
            </Host>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

function TraceTableHeader() {
  const colors = useAppColors();
  return (
    <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
      <Text style={[styles.tableHeading, styles.operationColumn, { color: colors.textSecondary }]}>Operation</Text>
      <Text style={[styles.tableHeading, styles.statusColumn, { color: colors.textSecondary }]}>Status</Text>
      <Text style={[styles.tableHeading, styles.startedColumn, { color: colors.textSecondary }]}>Started</Text>
      <Text style={[styles.tableHeading, styles.latencyColumn, { color: colors.textSecondary }]}>Latency</Text>
      <Text style={[styles.tableHeading, styles.tokensColumn, { color: colors.textSecondary }]}>Tokens</Text>
    </View>
  );
}

function TraceRow({ isWide, onPress, trace }: { isWide: boolean; onPress: () => void; trace: PhoenixTraceListItem }) {
  const colors = useAppColors();
  const isError = trace.statusCode === 'ERROR';
  const statusColor = isError ? colors.danger : trace.statusCode === 'OK' ? colors.success : colors.textSecondary;
  const statusLabel = isError ? 'Error' : trace.statusCode === 'OK' ? 'OK' : 'Unset';

  if (isWide) {
    return (
      <MotionPressable
        accessibilityLabel={`${trace.name}, ${statusLabel}, ${formatDuration(trace.latencyMs)}`}
        accessibilityHint="Opens trace details"
        accessibilityRole="button"
        onPress={onPress}
        style={[styles.tableRow, { borderBottomColor: colors.border }]}>
        <View style={styles.operationColumn}>
          <Text numberOfLines={1} style={[styles.traceName, { color: colors.text }]}>{trace.name}</Text>
          <Text numberOfLines={1} style={[styles.traceKind, { color: colors.textSecondary }]}>{formatKind(trace.spanKind)}</Text>
        </View>
        <View style={styles.statusColumn}>
          <View style={[styles.statusBadge, { backgroundColor: colors.backgroundSelected }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>
        <Text style={[styles.tableCell, styles.startedColumn, { color: colors.textSecondary }]}>{formatStartTime(trace.startTime)}</Text>
        <Text style={[styles.tableCell, styles.latencyColumn, { color: colors.text }]}>{formatDuration(trace.latencyMs)}</Text>
        <Text style={[styles.tableCell, styles.tokensColumn, { color: colors.text }]}>{formatTokens(trace.tokenCountTotal)}</Text>
      </MotionPressable>
    );
  }

  return (
    <MotionPressable
      accessibilityLabel={`${trace.name}, ${statusLabel}, ${formatDuration(trace.latencyMs)}`}
      accessibilityHint="Opens trace details"
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.mobileRow, { borderBottomColor: colors.border }]}>
      <View style={styles.mobilePrimaryRow}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <Text numberOfLines={1} style={[styles.traceName, styles.mobileTraceName, { color: colors.text }]}>{trace.name}</Text>
        <Text style={[styles.mobileTime, { color: colors.textSecondary }]}>{formatStartTime(trace.startTime)}</Text>
      </View>
      <View style={styles.mobileMetadata}>
        <Text numberOfLines={1} style={[styles.mobileMetaText, { color: colors.textSecondary }]}>{formatKind(trace.spanKind)}</Text>
        <View style={[styles.metaDivider, { backgroundColor: colors.border }]} />
        <Text style={[styles.mobileMetaText, { color: isError ? colors.danger : colors.textSecondary }]}>{statusLabel}</Text>
        <View style={[styles.metaDivider, { backgroundColor: colors.border }]} />
        <Text style={[styles.mobileMetaText, { color: colors.textSecondary }]}>{formatDuration(trace.latencyMs)}</Text>
        {trace.tokenCountTotal != null ? (
          <>
            <View style={[styles.metaDivider, { backgroundColor: colors.border }]} />
            <Text style={[styles.mobileMetaText, { color: colors.textSecondary }]}>{formatTokens(trace.tokenCountTotal)} tokens</Text>
          </>
        ) : null}
      </View>
    </MotionPressable>
  );
}

function TraceListState({
  filter,
  isError,
  isPending,
  message,
  retry,
}: {
  filter: PhoenixTraceFilter;
  isError: boolean;
  isPending: boolean;
  message?: string;
  retry: () => void;
}) {
  const colors = useAppColors();
  if (isPending) return <ActivityIndicator color={colors.accent} style={styles.stateLoader} />;

  if (isError) {
    return (
      <View style={styles.state}>
        <Text style={[styles.stateTitle, { color: colors.text }]}>Couldn’t load traces</Text>
        <Text style={[styles.stateCopy, { color: colors.textSecondary }]}>{message ?? 'Try refreshing this project.'}</Text>
        <MotionPressable
          accessibilityRole="button"
          onPress={retry}
          style={[styles.retryButton, { backgroundColor: colors.accent }]}>
          <Text style={[styles.retryLabel, { color: colors.accentForeground }]}>Try again</Text>
        </MotionPressable>
      </View>
    );
  }

  return (
    <View style={styles.state}>
      <Text style={[styles.stateTitle, { color: colors.text }]}>{filter === 'errors' ? 'No error traces' : 'No traces yet'}</Text>
      <Text style={[styles.stateCopy, { color: colors.textSecondary }]}>
        {filter === 'errors' ? 'No root spans with an error status were found.' : 'New traces will appear here as this project receives activity.'}
      </Text>
    </View>
  );
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 1) return '<1 ms';
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 10_000) return `${(milliseconds / 1000).toFixed(1)} s`;
  return `${Math.round(milliseconds / 1000)} s`;
}

function formatCompactNumber(value: number) {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}m`;
}

function formatTokens(value: number | null) {
  return value == null ? '—' : formatCompactNumber(value);
}

function formatKind(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function formatStartTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function createTraceRange(preset: TraceRangePreset, cacheKey?: string): TraceRangeSelection {
  const selected = RANGE_PRESETS.find((option) => option.value === preset) ?? RANGE_PRESETS[1];
  const endTime = new Date();
  return {
    cacheKey: cacheKey ?? `${preset}:${endTime.toISOString()}`,
    endTime: endTime.toISOString(),
    preset,
    startTime: new Date(endTime.getTime() - selected.durationMs).toISOString(),
  };
}

function formatRange(range: PhoenixTraceRange) {
  const start = new Date(range.startTime);
  const end = new Date(range.endTime);
  const spansMultipleDays = start.toDateString() !== end.toDateString();
  const options: Intl.DateTimeFormatOptions = spansMultipleDays
    ? { day: 'numeric', month: 'short' }
    : { hour: 'numeric', minute: '2-digit' };
  return `${start.toLocaleString([], options)} – ${end.toLocaleString([], options)}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  unavailableScreen: { alignItems: 'center', flex: 1, gap: 8, justifyContent: 'center', padding: 24 },
  list: { flex: 1 },
  content: { alignSelf: 'center', maxWidth: MaxContentWidth, paddingHorizontal: 20, width: '100%' },
  headerContent: { paddingTop: 18 },
  projectIntro: { gap: 7, paddingBottom: 28 },
  title: { fontFamily: AppFonts.semibold, fontSize: 32, letterSpacing: -1, lineHeight: 38 },
  description: { fontFamily: AppFonts.regular, fontSize: 16, lineHeight: 23, maxWidth: 620 },
  eyebrow: { fontFamily: AppFonts.semibold, fontSize: 13 },
  rangeDisclosure: { borderRadius: 16, borderWidth: 1, marginBottom: 16, overflow: 'hidden' },
  rangeSummaryRow: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 64, paddingHorizontal: 16, paddingVertical: 10 },
  rangeSummaryCopy: { flex: 1, gap: 5, minWidth: 0 },
  rangeSummaryState: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  rangeSummaryValue: { flex: 1, fontFamily: AppFonts.medium, fontSize: 14 },
  streamingDot: { borderRadius: 4, height: 8, width: 8 },
  rangeControlsClip: { overflow: 'hidden' },
  rangeControls: { borderTopWidth: StyleSheet.hairlineWidth, paddingBottom: 16, paddingHorizontal: 16, paddingTop: 14 },
  rangeControl: { paddingHorizontal: 6 },
  sliderHost: { height: 32, width: '100%' },
  rangeLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  rangeLabelButton: { alignItems: 'center', justifyContent: 'center', minHeight: 48, width: 52 },
  rangeLabel: { fontFamily: AppFonts.medium, fontSize: 12 },
  rangeDates: { fontFamily: AppFonts.regular, fontSize: 12, paddingTop: 6, textAlign: 'center' },
  streamingRow: { alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', marginTop: 22, minHeight: 64, paddingTop: 12 },
  streamingLabel: { flex: 1, fontFamily: AppFonts.medium, fontSize: 14 },
  summary: { borderRadius: 18, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', overflow: 'hidden' },
  metric: { flexGrow: 1, gap: 6, minHeight: 86, paddingHorizontal: 16, paddingVertical: 14 },
  metricLabel: { fontFamily: AppFonts.regular, fontSize: 12 },
  metricValue: { fontFamily: AppFonts.semibold, fontSize: 23, letterSpacing: -0.5 },
  metricLoader: { alignSelf: 'flex-start', height: 28 },
  traceHeading: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between', paddingTop: 30 },
  sectionTitle: { fontFamily: AppFonts.semibold, fontSize: 20, letterSpacing: -0.3 },
  filterScroller: { marginHorizontal: -20 },
  filters: { gap: 8, paddingHorizontal: 20, paddingVertical: 14 },
  filter: { alignItems: 'center', borderRadius: 24, borderWidth: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: 18 },
  filterLabel: { fontFamily: AppFonts.medium, fontSize: 13 },
  tableHeader: { borderBottomWidth: 1, flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10 },
  tableHeading: { fontFamily: AppFonts.medium, fontSize: 11 },
  tableRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', minHeight: 72, paddingHorizontal: 12, paddingVertical: 11 },
  tableCell: { fontFamily: AppFonts.regular, fontSize: 13 },
  operationColumn: { flex: 1, minWidth: 0, paddingRight: 12 },
  statusColumn: { width: 90 },
  startedColumn: { width: 100 },
  latencyColumn: { width: 88 },
  tokensColumn: { textAlign: 'right', width: 72 },
  traceName: { fontFamily: AppFonts.medium, fontSize: 14 },
  traceKind: { fontFamily: AppFonts.regular, fontSize: 11, marginTop: 4 },
  statusBadge: { alignItems: 'center', alignSelf: 'flex-start', borderRadius: 12, flexDirection: 'row', gap: 6, paddingHorizontal: 8, paddingVertical: 5 },
  statusDot: { borderRadius: 4, height: 8, width: 8 },
  statusText: { fontFamily: AppFonts.medium, fontSize: 11 },
  mobileRow: { borderBottomWidth: 1, gap: 9, minHeight: 78, paddingHorizontal: 2, paddingVertical: 15 },
  mobilePrimaryRow: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  mobileTraceName: { flex: 1, fontSize: 15 },
  mobileTime: { fontFamily: AppFonts.regular, fontSize: 12 },
  mobileMetadata: { alignItems: 'center', flexDirection: 'row', gap: 8, paddingLeft: 17 },
  mobileMetaText: { flexShrink: 1, fontFamily: AppFonts.regular, fontSize: 12 },
  metaDivider: { borderRadius: 2, height: 3, width: 3 },
  stateLoader: { paddingVertical: Spacing.six },
  state: { alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingVertical: 54 },
  stateTitle: { fontFamily: AppFonts.semibold, fontSize: 17, textAlign: 'center' },
  stateCopy: { fontFamily: AppFonts.regular, fontSize: 14, lineHeight: 21, maxWidth: 360, textAlign: 'center' },
  retryButton: { borderRadius: 16, justifyContent: 'center', marginTop: 8, minHeight: 48, paddingHorizontal: 20 },
  retryLabel: { fontFamily: AppFonts.semibold, fontSize: 14 },
  footerLoader: { paddingVertical: 24 },
  listEnd: { fontFamily: AppFonts.regular, fontSize: 12, paddingVertical: 24, textAlign: 'center' },
});

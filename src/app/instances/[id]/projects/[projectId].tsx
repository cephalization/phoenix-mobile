import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
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

import { MotionPressable } from '@/components/motion-pressable';
import { AppFonts, MaxContentWidth, Spacing, useAppColors } from '@/constants/theme';
import {
  type PhoenixTraceFilter,
  type PhoenixTraceListItem,
  usePhoenixProjects,
  usePhoenixProjectTraces,
} from '@/hooks/use-phoenix-data';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';

const FILTERS: { label: string; value: PhoenixTraceFilter }[] = [
  { label: 'Recent', value: 'recent' },
  { label: 'Errors', value: 'errors' },
  { label: 'Slowest', value: 'slowest' },
];

export default function ProjectTracesScreen() {
  const { id, projectId } = useLocalSearchParams<{ id: string; projectId: string }>();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWide = width >= 700;
  const [filter, setFilter] = useState<PhoenixTraceFilter>('recent');
  const instance = useInstanceStore((state) => state.instances.find((candidate) => candidate.id === id));
  const projects = usePhoenixProjects(instance);
  const project = projects.data?.find((candidate) => candidate.id === projectId);
  const recentTraces = usePhoenixProjectTraces(instance, projectId, 'recent');
  const activeTraces = usePhoenixProjectTraces(instance, projectId, filter);
  const traces = activeTraces.data?.pages.flatMap((page) => page.items) ?? [];
  const sample = recentTraces.data?.pages[0]?.items ?? [];
  const refreshing = activeTraces.isRefetching && !activeTraces.isFetchingNextPage;

  if (!instance) {
    return <UnavailableState message="This Phoenix connection is no longer on this device." title="Instance not found" />;
  }

  if (projects.isSuccess && !project) {
    return <UnavailableState message="This project is no longer available on the connected instance." title="Project not found" />;
  }

  const refresh = async () => {
    if (refreshing) return;
    haptics.selection();
    const results = await Promise.all([
      activeTraces.refetch(),
      ...(filter === 'recent' ? [] : [recentTraces.refetch()]),
    ]);
    if (results.some((result) => result.isError)) haptics.error();
    else haptics.light();
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerBackTitle: instance?.name ?? 'Instance',
          scrollEdgeEffects: { bottom: 'soft' },
          title: project?.name ?? 'Project',
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

            <View style={styles.sampleHeading}>
              <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>Latest sample</Text>
              <Text style={[styles.sampleNote, { color: colors.textSecondary }]}>Up to 30 recent traces</Text>
            </View>
            <TraceSummary isLoading={recentTraces.isPending} isWide={isWide} traces={sample} />

            <View style={styles.traceHeading}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Traces</Text>
              <Text style={[styles.resultCount, { color: colors.textSecondary }]}>{traces.length} loaded</Text>
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
            refreshing={refreshing}
            tintColor={colors.brand}
          />
        }
        removeClippedSubviews={Platform.OS === 'android'}
        renderItem={({ item }) => <TraceRow isWide={isWide} trace={item} />}
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
  traces,
}: {
  isLoading: boolean;
  isWide: boolean;
  traces: PhoenixTraceListItem[];
}) {
  const colors = useAppColors();
  const latencies = traces.map((trace) => trace.latencyMs).sort((a, b) => a - b);
  const middle = Math.floor(latencies.length / 2);
  const median = latencies.length === 0
    ? null
    : latencies.length % 2 === 0
      ? (latencies[middle - 1] + latencies[middle]) / 2
      : latencies[middle];
  const errors = traces.filter((trace) => trace.statusCode === 'ERROR').length;
  const tokens = traces.reduce((total, trace) => total + (trace.tokenCountTotal ?? 0), 0);
  const metrics = [
    { label: 'Traces', value: String(traces.length) },
    { label: 'Errors', value: traces.length > 0 ? `${Math.round((errors / traces.length) * 100)}%` : '—' },
    { label: 'Median', value: median == null ? '—' : formatDuration(median) },
    { label: 'Tokens', value: traces.some((trace) => trace.tokenCountTotal != null) ? formatCompactNumber(tokens) : '—' },
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

function TraceRow({ isWide, trace }: { isWide: boolean; trace: PhoenixTraceListItem }) {
  const colors = useAppColors();
  const isError = trace.statusCode === 'ERROR';
  const statusColor = isError ? colors.danger : trace.statusCode === 'OK' ? colors.success : colors.textSecondary;
  const statusLabel = isError ? 'Error' : trace.statusCode === 'OK' ? 'OK' : 'Unset';

  if (isWide) {
    return (
      <View
        accessibilityLabel={`${trace.name}, ${statusLabel}, ${formatDuration(trace.latencyMs)}`}
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
      </View>
    );
  }

  return (
    <View
      accessibilityLabel={`${trace.name}, ${statusLabel}, ${formatDuration(trace.latencyMs)}`}
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
    </View>
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

const styles = StyleSheet.create({
  screen: { flex: 1 },
  unavailableScreen: { alignItems: 'center', flex: 1, gap: 8, justifyContent: 'center', padding: 24 },
  list: { flex: 1 },
  content: { alignSelf: 'center', maxWidth: MaxContentWidth, paddingHorizontal: 20, width: '100%' },
  headerContent: { paddingTop: 18 },
  projectIntro: { gap: 7, paddingBottom: 28 },
  title: { fontFamily: AppFonts.semibold, fontSize: 32, letterSpacing: -1, lineHeight: 38 },
  description: { fontFamily: AppFonts.regular, fontSize: 16, lineHeight: 23, maxWidth: 620 },
  sampleHeading: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 10 },
  eyebrow: { fontFamily: AppFonts.semibold, fontSize: 13 },
  sampleNote: { fontFamily: AppFonts.regular, fontSize: 12 },
  summary: { borderRadius: 18, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', overflow: 'hidden' },
  metric: { flexGrow: 1, gap: 6, minHeight: 86, paddingHorizontal: 16, paddingVertical: 14 },
  metricLabel: { fontFamily: AppFonts.regular, fontSize: 12 },
  metricValue: { fontFamily: AppFonts.semibold, fontSize: 23, letterSpacing: -0.5 },
  metricLoader: { alignSelf: 'flex-start', height: 28 },
  traceHeading: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between', paddingTop: 30 },
  sectionTitle: { fontFamily: AppFonts.semibold, fontSize: 20, letterSpacing: -0.3 },
  resultCount: { fontFamily: AppFonts.regular, fontSize: 12 },
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

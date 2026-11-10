import { router, Stack, useNavigation } from 'expo-router';
import { use, useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { NavigationProp, ParamListBase } from 'expo-router/react-navigation';
import type { NativeStackHeaderItemMenu } from 'expo-router/native-stack';

import { ContentColumn } from '@/components/duo/content-column';
import { CachedDataNotice } from '@/components/offline/cached-data-notice';
import { isDeviceOffline, isUnavailableOffline } from '@/components/offline/offline-state';
import { OfflineUnavailable } from '@/components/offline/offline-unavailable';
import { usePxiHeaderOptions } from '@/components/pxi-header-button';
import { InlineChoice, ProjectViewPicker } from '@/components/traces/project-list-header';
import { Bars, type BarValue } from '@/components/ui/charts/bars';
import { ChartSection } from '@/components/ui/charts/chart-section';
import { Lines, MiniLine } from '@/components/ui/charts/lines';
import { niceMaximum } from '@/components/ui/charts/scale';
import { ScrubSurface } from '@/components/ui/charts/scrub-surface';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow, RowInset } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { type Stat, StatStrip } from '@/components/ui/stat-strip';
import { AppFonts, SurfaceContext, Type, useAppColors } from '@/constants/theme';
import { nativeHeaderTitle, useDuoLayout } from '@/features/duo/layout';
import type { EvalSeries, ModelCost, ProjectOverview as Overview } from '@/features/metrics/api';
import { errorRate, formatCost, formatPercent, statusTotals } from '@/features/metrics/health';
import { overviewKey, useOverviewStore } from '@/features/metrics/overview-store';
import {
  createMetricsWindow,
  formatBinRange,
  formatSpan,
  type MetricsWindow,
} from '@/features/metrics/window';
import { useInstanceReachability } from '@/features/offline/reachability';
import { traceRangePreset, TraceRangePresets } from '@/features/traces/range';
import { usePhoenixProjects } from '@/hooks/use-phoenix-data';
import { useMetricsSupported, useProjectOverview } from '@/hooks/use-phoenix-metrics';
import { formatCompactNumber, formatDuration } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';
import { type TraceRangePreset, useSettingsStore } from '@/store/settings';

const Heights = {
  compact: { traffic: 120, line: 96, cost: 72 },
  // The detail column of the open iPhone Duo has the height for taller plots.
  board: { traffic: 200, line: 140, cost: 110 },
};

/** Charts sit side by side from this column width. */
const SideBySideWidth = 480;

/** Hours listed beside the charts on the open Duo. */
const ListedHours = 6;

/** An eval's drop that earns `danger`: scores are 0–1 for most evaluators. */
const EvalDropThreshold = 0.05;

/**
 * A project at a glance: how much ran, how much failed, how slow and how
 * costly it was, and whether its evals are drifting, across the range the
 * project's other views share. Every chart is scrubbable and they share one
 * selection, so inspecting an hour on one marks it on all of them, and the
 * readout above the charts opens that hour's traces or errors.
 *
 * In an expanded split (the open iPhone Duo) the sidebar keeps the figures
 * and lists and `ProjectOverviewBoard` draws the charts in the detail column;
 * the two share the range and selection through `useOverviewStore`.
 */
export function ProjectOverview({
  active,
  id,
  projectId,
}: {
  /** False while the project shows another view; the overview stays mounted but idle. */
  active: boolean;
  id: string;
  projectId: string;
}) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { systemBarEdge } = useDuoLayout();
  const nativeBar = Platform.OS === 'ios';
  const setTraceRangePreset = useSettingsStore((state) => state.setTraceRangePreset);
  const inSidebar = use(SurfaceContext) === 'sidebar';
  const key = overviewKey(id, projectId);

  const [initialWindow] = useState<MetricsWindow>(() =>
    createMetricsWindow(useSettingsStore.getState().traceRangePreset),
  );

  const stored = useOverviewStore((state) => state.entries[key]);
  const ensureOverview = useOverviewStore((state) => state.ensure);
  const storeWindow = useOverviewStore((state) => state.setWindow);
  const storeSelection = useOverviewStore((state) => state.select);
  const window = stored?.window ?? initialWindow;
  const selected = stored?.selected ?? null;
  const setWindow = (next: MetricsWindow) => storeWindow(key, next);
  const setSelected = (next: number | null) => storeSelection(key, next);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => ensureOverview(key, initialWindow), [ensureOverview, initialWindow, key]);

  const instance = useInstanceStore((state) =>
    state.instances.find((candidate) => candidate.id === id),
  );

  const offline = useInstanceReachability(id).state === 'offline';
  const supported = useMetricsSupported(instance);
  const projects = usePhoenixProjects(instance);
  const project = projects.data?.find((candidate) => candidate.id === projectId);
  const overview = useProjectOverview(instance, projectId, window);
  const pxiHeader = usePxiHeaderOptions(instance);

  if (!instance) return null;

  const changeRange = (preset: TraceRangePreset) => {
    if (preset === window.preset) return;
    haptics.selection();
    setTraceRangePreset(preset);
    setWindow(createMetricsWindow(preset));
  };

  const refresh = async () => {
    if (isDeviceOffline()) {
      haptics.warning();

      return;
    }

    haptics.selection();
    setRefreshing(true);
    setWindow(createMetricsWindow(window.preset));
    setRefreshing(false);
  };

  const openBin = (index: number, errorsOnly: boolean) => {
    const params = binParams(window, index, errorsOnly);

    if (!params) return;
    haptics.light();
    navigation.setParams(params);
  };

  const rangeLabel = traceRangePreset(window.preset).label;

  const rangeMenu: NativeStackHeaderItemMenu = {
    type: 'menu',
    identifier: 'overview-range',
    label: 'Time range',
    accessibilityLabel: `Time range, ${rangeLabel}`,
    icon: { type: 'sfSymbol', name: 'calendar' },
    menu: {
      items: TraceRangePresets.map((option) => ({
        type: 'action',
        label: option.label,
        state: option.value === window.preset ? 'on' : 'off',
        onPress: () => changeRange(option.value),
      })),
    },
  };

  const data = overview.data;

  const body =
    supported === false ? (
      <EmptyState
        action={{
          label: 'Show traces',
          onPress: () => navigation.setParams({ view: 'traces' }),
        }}
        message="The overview reads Phoenix's project metrics, added in Phoenix 11.11."
        symbol={{ android: 'monitoring', ios: 'chart.bar.xaxis' }}
        title="Update Phoenix for the overview"
      />
    ) : isUnavailableOffline(overview, offline) ? (
      <OfflineUnavailable instanceName={instance.name} onRetry={() => void overview.refetch()} />
    ) : data === undefined && overview.isError ? (
      <EmptyState
        action={{ label: 'Try again', onPress: () => void overview.refetch() }}
        message={overview.error.message}
        symbol={{ android: 'error', ios: 'exclamationmark.triangle' }}
        title="Couldn’t load the overview"
      />
    ) : data === undefined ? (
      <EmptyState loading title="Loading overview" />
    ) : (
      <OverviewCharts
        data={data}
        layout={inSidebar ? 'sidebar' : 'page'}
        onOpenBin={openBin}
        onSelect={setSelected}
        rangeLabel={rangeLabel}
        selected={selected}
        window={window}
      />
    );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {active ? (
        <Stack.Screen
          options={{
            headerBackTitle: instance.name,
            title: nativeHeaderTitle(systemBarEdge, project?.name ?? 'Project'),
            headerRight: nativeBar ? undefined : pxiHeader.headerRight,
            // PXI comes last, which puts it at the top of a vertical bar.
            unstable_headerRightItems: nativeBar
              ? (props) => [rangeMenu, ...(pxiHeader.unstable_headerRightItems?.(props) ?? [])]
              : undefined,
          }}
        />
      ) : null}
      <ContentColumn padding={0}>
        {(column) => (
          <ScrollView
            contentContainerStyle={[styles.content, column, { paddingBottom: 32 + insets.bottom }]}
            contentInsetAdjustmentBehavior="automatic"
            refreshControl={
              <RefreshControl
                colors={[colors.textSecondary]}
                onRefresh={refresh}
                progressBackgroundColor={colors.backgroundElement}
                refreshing={refreshing || (overview.isFetching && overview.isPlaceholderData)}
                tintColor={colors.textSecondary}
              />
            }
          >
            <CachedDataNotice dataUpdatedAt={overview.dataUpdatedAt} instance={instance} />
            <ProjectViewPicker title={project?.name} value="overview" />
            {nativeBar ? null : (
              <InlineChoice
                label="Range"
                onChange={changeRange}
                options={TraceRangePresets.map((option) => ({
                  label: option.shortLabel,
                  value: option.value,
                }))}
                value={window.preset}
              />
            )}
            {body}
          </ScrollView>
        )}
      </ContentColumn>
    </View>
  );
}

/** The Traces view's parameters for one bin, or null outside the window. */
function binParams(window: MetricsWindow, index: number, errorsOnly: boolean) {
  const start = window.bins[index];

  if (start === undefined) return null;

  return {
    filter: undefined,
    from: new Date(start).toISOString(),
    show: errorsOnly ? 'errors' : undefined,
    to: new Date(Math.min(start + window.binMs, window.end)).toISOString(),
    view: 'traces',
  };
}

/**
 * The overview's content. `page` is the whole overview on one column; in a
 * `sidebar` the charts move to the detail column, so it keeps the figures,
 * the readout, and the lists, with the notable hours as rows to pick from.
 */
function OverviewCharts({
  data,
  layout,
  onOpenBin,
  onSelect,
  rangeLabel,
  selected,
  window,
}: {
  data: Overview;
  layout: 'page' | 'sidebar';
  rangeLabel: string;
  selected: number | null;
  window: MetricsWindow;
  onOpenBin: (index: number, errorsOnly: boolean) => void;
  onSelect: (index: number | null) => void;
}) {
  const totals = statusTotals(data.status);
  const rate = errorRate(totals);
  const previousRate = errorRate(data.previous);
  const bin = selected === null ? null : data.status[selected];
  const binLabel = selected === null ? null : formatBinRange(window, window.bins[selected] ?? 0);

  if (totals.traces === 0) {
    return (
      <EmptyState
        message={`No traces arrived in the ${rangeLabel.toLowerCase()}. Try a longer range.`}
        symbol={{ android: 'monitoring', ios: 'chart.bar.xaxis' }}
        title="Nothing to chart yet"
      />
    );
  }

  const stats: Stat[] = [
    {
      label: 'Traces',
      value: formatCompactNumber(totals.traces),
      detail: change(totals.traces, data.previous.traces),
    },
    {
      label: 'Errors',
      value: rate === null ? '—' : formatPercent(rate),
      tone: totals.errors > 0 ? 'danger' : 'default',
      detail: previousRate === null ? undefined : `was ${formatPercent(previousRate)}`,
      detailTone:
        rate !== null && previousRate !== null && totals.errors >= 3 && rate >= previousRate * 1.5
          ? 'danger'
          : 'default',
    },
    {
      label: 'p95',
      value: data.p95 === null ? '—' : formatDuration(data.p95),
      detail: data.previous.p95 === null ? undefined : `was ${formatDuration(data.previous.p95)}`,
      detailTone:
        data.p95 !== null && data.previous.p95 !== null && data.p95 >= data.previous.p95 * 1.5
          ? 'danger'
          : 'default',
    },
    {
      label: 'Cost',
      value: data.totalCost === null ? '—' : formatCost(data.totalCost),
      detail:
        data.totalCost === null || data.previous.cost === null
          ? undefined
          : change(data.totalCost, data.previous.cost),
    },
  ];

  return (
    <View>
      <StatStrip stats={stats} />
      {/* Beside the board, the readout lives with the charts in the detail column. */}
      {layout === 'page' ? (
        <Readout
          bin={bin ?? null}
          label={binLabel}
          onClear={() => onSelect(null)}
          onOpenErrors={() => selected !== null && onOpenBin(selected, true)}
          onOpenTraces={() => selected !== null && onOpenBin(selected, false)}
          rangeLabel={rangeLabel}
        />
      ) : null}
      {layout === 'sidebar' ? (
        <NotableHours data={data} onSelect={onSelect} selected={selected} window={window} />
      ) : (
        <ChartStack
          data={data}
          onSelect={onSelect}
          rangeLabel={rangeLabel}
          selected={selected}
          size="compact"
          window={window}
        />
      )}
      {data.models.length > 0 ? <ModelCosts models={data.models} /> : null}
      {data.evals.length > 0 ? (
        <Evals evals={data.evals} selected={selected} window={window} />
      ) : null}
    </View>
  );
}

/**
 * The overview's charts, sharing one selection: traffic with errors, latency
 * percentiles, and cost. `board` is the detail column's taller set, with
 * latency and cost side by side when the column is wide enough.
 */
function ChartStack({
  data,
  onSelect,
  rangeLabel,
  selected,
  size,
  window,
}: {
  data: Overview;
  rangeLabel: string;
  selected: number | null;
  size: 'compact' | 'board';
  window: MetricsWindow;
  onSelect: (index: number | null) => void;
}) {
  const { width: columnWidth } = useDuoLayout();
  const heights = Heights[size];
  const sideBySide = size === 'board' && columnWidth >= SideBySideWidth;
  const count = window.bins.length;
  const firstLabel = `${traceRangePreset(window.preset).shortLabel} ago`;
  const totals = statusTotals(data.status);
  const traffic: BarValue[] = data.status.map((bin) => ({ base: bin.ok, alert: bin.errors }));

  const trafficMaximum = niceMaximum(
    Math.max(0, ...traffic.map((bar) => bar.base + (bar.alert ?? 0))),
  );

  const p95s = data.latency.map((bin) => bin.p95);
  const p50s = data.latency.map((bin) => bin.p50);
  const latencyMaximum = niceMaximum(Math.max(0, ...p95s.map((value) => value ?? 0)));
  const costs = data.cost.map((value) => ({ base: value ?? 0 }));
  const costMaximum = niceMaximum(Math.max(0, ...data.cost.map((value) => value ?? 0)));
  const hasCost = data.cost.some((value) => (value ?? 0) > 0);
  const bin = selected === null ? null : data.status[selected];
  const binLabel = selected === null ? null : formatBinRange(window, window.bins[selected] ?? 0);

  const latency = (
    <ChartSection
      endLabel="now"
      maximumLabel={formatDuration(latencyMaximum)}
      startLabel={firstLabel}
      title="Latency · p95 and p50"
      value={latencyValue(
        selected === null ? { p50: data.p50, p95: data.p95 } : data.latency[selected],
      )}
    >
      <ScrubSurface
        accessibilityLabel={`Trace latency per ${binNoun(window)}, ${rangeLabel}`}
        accessibilityValue={
          selected !== null && binLabel
            ? `${binLabel}: ${latencyValue(data.latency[selected])}`
            : undefined
        }
        count={count}
        height={heights.line}
        onSelect={onSelect}
        selected={selected}
      >
        {(width) => (
          <Lines
            height={heights.line}
            maximum={latencyMaximum}
            selected={selected}
            series={[
              { key: 'p95', values: p95s, emphasis: 'primary' },
              { key: 'p50', values: p50s, emphasis: 'secondary' },
            ]}
            width={width}
          />
        )}
      </ScrubSurface>
    </ChartSection>
  );

  const cost = hasCost ? (
    <ChartSection
      endLabel="now"
      maximumLabel={formatCost(costMaximum)}
      startLabel={firstLabel}
      title="Cost"
      value={
        selected === null ? formatCost(data.totalCost ?? 0) : formatCost(data.cost[selected] ?? 0)
      }
    >
      <ScrubSurface
        accessibilityLabel={`Cost per ${binNoun(window)}, ${rangeLabel}`}
        accessibilityValue={
          selected !== null && binLabel
            ? `${binLabel}: ${formatCost(data.cost[selected] ?? 0)}`
            : undefined
        }
        count={count}
        height={heights.cost}
        onSelect={onSelect}
        selected={selected}
      >
        {(width) => (
          <Bars
            height={heights.cost}
            maximum={costMaximum}
            selected={selected}
            values={costs}
            width={width}
          />
        )}
      </ScrubSurface>
    </ChartSection>
  ) : null;

  return (
    <View>
      <ChartSection
        endLabel="now"
        maximumLabel={formatCompactNumber(trafficMaximum)}
        startLabel={firstLabel}
        title="Traces"
        value={
          bin
            ? `${formatCompactNumber(bin.ok + bin.errors)} · ${formatCompactNumber(bin.errors)} errors`
            : `${formatCompactNumber(totals.traces)} · ${formatCompactNumber(totals.errors)} errors`
        }
      >
        <ScrubSurface
          accessibilityLabel={`Traces per ${binNoun(window)}, ${rangeLabel}`}
          accessibilityValue={
            bin && binLabel
              ? `${binLabel}: ${bin.ok + bin.errors} traces, ${bin.errors} errors`
              : undefined
          }
          count={count}
          height={heights.traffic}
          onSelect={onSelect}
          selected={selected}
        >
          {(width) => (
            <Bars
              height={heights.traffic}
              maximum={trafficMaximum}
              selected={selected}
              values={traffic}
              width={width}
            />
          )}
        </ScrubSurface>
      </ChartSection>
      {sideBySide && cost ? (
        <View style={styles.pair}>
          <View style={styles.pairItem}>{latency}</View>
          <View style={styles.pairItem}>{cost}</View>
        </View>
      ) : (
        <>
          {latency}
          {cost}
        </>
      )}
    </View>
  );
}

/**
 * The hours worth a look, as rows: those with the most errors, or the
 * busiest when nothing failed. A row selects its hour, so on the open Duo the
 * charts beside the list mark it; the readout then opens it.
 */
function NotableHours({
  data,
  onSelect,
  selected,
  window,
}: {
  data: Overview;
  selected: number | null;
  window: MetricsWindow;
  onSelect: (index: number | null) => void;
}) {
  const anyErrors = data.status.some((bin) => bin.errors > 0);

  const hours = data.status
    .map((bin, index) => ({ bin, index }))
    .filter(({ bin }) => (anyErrors ? bin.errors > 0 : bin.ok > 0))
    .sort((left, right) =>
      anyErrors
        ? right.bin.errors - left.bin.errors || right.index - left.index
        : right.bin.ok - left.bin.ok || right.index - left.index,
    )
    .slice(0, ListedHours);

  if (hours.length === 0) return null;

  return (
    <View>
      <SectionHeader
        label={
          anyErrors ? `${capitalize(binNoun(window))}s with errors` : `Busiest ${binNoun(window)}s`
        }
      />
      {hours.map(({ bin, index }) => {
        const total = bin.ok + bin.errors;
        const rate = total === 0 ? 0 : bin.errors / total;

        return (
          <ListRow
            key={window.bins[index]}
            meta={anyErrors ? `${formatCompactNumber(bin.errors)} err` : formatCompactNumber(total)}
            onPress={() => onSelect(selected === index ? null : index)}
            selected={selected === index}
            subtitle={`${formatCompactNumber(total)} traces${anyErrors ? ` · ${formatPercent(rate)} errors` : ''}`}
            subtitleTone={anyErrors && rate >= 0.05 ? 'danger' : 'default'}
            title={formatBinRange(window, window.bins[index] ?? 0)}
          />
        );
      })}
    </View>
  );
}

/**
 * The overview's charts in the detail column of an expanded split, beside
 * the sidebar's figures and lists. It reads the range and selection the
 * sidebar's overview keeps in `useOverviewStore`, so both always agree, and
 * opens a bin's traces on the project route, which is the focused route while
 * the detail column is empty.
 */
export function ProjectOverviewBoard({
  instanceId,
  projectId,
}: {
  instanceId: string;
  projectId: string;
}) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const key = overviewKey(instanceId, projectId);
  const stored = useOverviewStore((state) => state.entries[key]);
  const storeSelection = useOverviewStore((state) => state.select);

  const instance = useInstanceStore((state) =>
    state.instances.find((candidate) => candidate.id === instanceId),
  );

  const projects = usePhoenixProjects(instance);
  const project = projects.data?.find((candidate) => candidate.id === projectId);
  const storedWindow = stored?.window;

  // The sidebar starts the entry; until it has, nothing is fetched twice.
  const overview = useProjectOverview(
    instance,
    projectId,
    storedWindow ?? placeholderWindow,
    storedWindow !== undefined,
  );

  if (!instance || !stored) return <EmptyState loading title="Loading overview" />;

  const { selected, window } = stored;
  const data = overview.data;
  const rangeLabel = traceRangePreset(window.preset).label;
  const select = (next: number | null) => storeSelection(key, next);

  const open = (index: number, errorsOnly: boolean) => {
    const params = binParams(window, index, errorsOnly);

    if (!params) return;
    haptics.light();
    router.setParams(params);
  };

  if (data === undefined) {
    return overview.isError ? (
      <EmptyState
        action={{ label: 'Try again', onPress: () => void overview.refetch() }}
        message={overview.error.message}
        symbol={{ android: 'error', ios: 'exclamationmark.triangle' }}
        title="Couldn’t load the overview"
      />
    ) : (
      <EmptyState loading title="Loading overview" />
    );
  }

  const bin = selected === null ? null : (data.status[selected] ?? null);

  return (
    <ContentColumn padding={0}>
      {(column) => (
        <ScrollView
          contentContainerStyle={[styles.content, column, { paddingBottom: 32 + insets.bottom }]}
          contentInsetAdjustmentBehavior="automatic"
          style={{ backgroundColor: colors.background }}
        >
          <View style={styles.boardHeading}>
            <Text numberOfLines={1} style={[Type.title, { color: colors.text }]}>
              {project?.name ?? 'Overview'}
            </Text>
          </View>
          <Readout
            bin={bin}
            label={selected === null ? null : formatBinRange(window, window.bins[selected] ?? 0)}
            onClear={() => select(null)}
            onOpenErrors={() => selected !== null && open(selected, true)}
            onOpenTraces={() => selected !== null && open(selected, false)}
            rangeLabel={rangeLabel}
          />
          <ChartStack
            data={data}
            onSelect={select}
            rangeLabel={rangeLabel}
            selected={selected}
            size="board"
            window={window}
          />
        </ScrollView>
      )}
    </ContentColumn>
  );
}

/** A query key stand-in while the sidebar has not started the overview; never fetched. */
const placeholderWindow = createMetricsWindow('day', 0, 0);

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * What the charts are pointing at: the selected bin with its two ways into
 * the traces, or the range and a hint while nothing is selected.
 */
function Readout({
  bin,
  label,
  onClear,
  onOpenErrors,
  onOpenTraces,
  rangeLabel,
}: {
  bin: { ok: number; errors: number } | null;
  label: string | null;
  rangeLabel: string;
  onClear: () => void;
  onOpenErrors: () => void;
  onOpenTraces: () => void;
}) {
  const colors = useAppColors();

  if (bin === null || label === null) {
    return (
      <View style={[styles.readout, { borderColor: colors.separator }]}>
        <Text style={[Type.subhead, { color: colors.textSecondary }]}>
          {rangeLabel} · Drag across a chart to inspect it
        </Text>
      </View>
    );
  }

  const total = bin.ok + bin.errors;

  return (
    <View style={[styles.readout, styles.readoutActive, { borderColor: colors.separator }]}>
      <Pressable
        accessibilityHint="Clears the selection"
        accessibilityLabel={`${label}, ${total} traces, ${bin.errors} errors`}
        accessibilityRole="button"
        onPress={onClear}
        style={styles.readoutLabel}
      >
        <Text numberOfLines={1} style={[Type.headline, { color: colors.text }]}>
          {label}
        </Text>
      </Pressable>
      <ReadoutAction disabled={total === 0} label="Traces" onPress={onOpenTraces} />
      {bin.errors > 0 ? (
        <ReadoutAction
          danger
          label={`${formatCompactNumber(bin.errors)} errors`}
          onPress={onOpenErrors}
        />
      ) : null}
    </View>
  );
}

function ReadoutAction({
  danger = false,
  disabled = false,
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const colors = useAppColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      // The pill is 32 points tall; the slop makes the target 48.
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: pressed ? colors.rowSelected : colors.backgroundSelected },
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[Type.label, styles.actionLabel, { color: danger ? colors.danger : colors.text }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Spend by model across the range, largest first, as flat rows with a proportional rule. */
function ModelCosts({ models }: { models: readonly ModelCost[] }) {
  const colors = useAppColors();
  const top = models.slice(0, 5);
  const largest = Math.max(...top.map((model) => model.cost));

  return (
    <View>
      <SectionHeader label="Cost by model" />
      {top.map((model) => (
        <View
          accessibilityLabel={`${model.name}, ${formatCost(model.cost)}, ${formatCompactNumber(model.tokens)} tokens`}
          accessible
          key={model.name}
          style={styles.rankRow}
        >
          <View style={styles.rankLine}>
            <Text numberOfLines={1} style={[Type.subhead, styles.rankName, { color: colors.text }]}>
              {model.name}
            </Text>
            <Text style={[Type.mono, { color: colors.textSecondary }]}>
              {formatCompactNumber(Math.round(model.tokens))} tok
            </Text>
            <Text style={[Type.mono, styles.rankValue, { color: colors.text }]}>
              {formatCost(model.cost)}
            </Text>
          </View>
          <View style={[styles.rankTrack, { backgroundColor: colors.separator }]}>
            <View
              style={[
                styles.rankFill,
                { backgroundColor: colors.textTertiary, width: `${(model.cost / largest) * 100}%` },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Each eval's mean score, its trend line, and how far the recent half moved
 * from the first half. A drop is the one change that earns `danger`.
 */
function Evals({
  evals,
  selected,
  window,
}: {
  evals: readonly EvalSeries[];
  selected: number | null;
  window: MetricsWindow;
}) {
  const colors = useAppColors();

  return (
    <View>
      <SectionHeader label="Evals" />
      {evals.map((series) => {
        const scored = series.scores.filter((score) => score !== null);
        const mean = average(scored);
        const half = Math.floor(series.scores.length / 2);
        const before = average(series.scores.slice(0, half).filter((score) => score !== null));
        const after = average(series.scores.slice(half).filter((score) => score !== null));
        const drift = before === null || after === null ? null : after - before;
        const shown = selected === null ? mean : (series.scores[selected] ?? null);
        const dropped = drift !== null && drift <= -EvalDropThreshold;

        return (
          <View
            accessibilityLabel={`${series.name}, mean ${shown?.toFixed(2) ?? 'no score'}${drift === null ? '' : `, ${drift >= 0 ? 'up' : 'down'} ${Math.abs(drift).toFixed(2)}`}`}
            accessible
            key={series.name}
            style={styles.evalRow}
          >
            <View style={styles.evalName}>
              <Text numberOfLines={1} style={[Type.headline, { color: colors.text }]}>
                {series.name}
              </Text>
              {drift === null ? null : (
                <Text style={[Type.mono, { color: dropped ? colors.danger : colors.textTertiary }]}>
                  {drift >= 0 ? '▲' : '▼'} {Math.abs(drift).toFixed(2)} vs first{' '}
                  {formatSpan(half * window.binMs)}
                </Text>
              )}
            </View>
            <MiniLine values={series.scores} />
            <Text style={[Type.monoValue, styles.evalValue, { color: colors.text }]}>
              {shown === null ? '—' : shown.toFixed(2)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function average(values: readonly (number | null)[]): number | null {
  let sum = 0;
  let count = 0;

  for (const value of values) {
    if (value === null) continue;
    sum += value;
    count += 1;
  }

  return count === 0 ? null : sum / count;
}

/** `+12%`, `−40%`, or `new` when the previous window was empty. */
function change(current: number, previous: number): string | undefined {
  if (previous === 0) return current > 0 ? 'new' : undefined;
  const ratio = current / previous - 1;

  if (Math.abs(ratio) < 0.005) return 'flat';

  return `${ratio > 0 ? '+' : '−'}${formatPercent(Math.abs(ratio))}`;
}

function latencyValue(bin: { p50: number | null; p95: number | null } | undefined): string {
  if (!bin || (bin.p95 === null && bin.p50 === null)) return '—';

  return `p95 ${bin.p95 === null ? '—' : formatDuration(bin.p95)} · p50 ${bin.p50 === null ? '—' : formatDuration(bin.p50)}`;
}

function binNoun(window: MetricsWindow) {
  return window.scale === 'MINUTE' ? 'minute' : window.scale === 'HOUR' ? 'hour' : 'day';
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pair: { flexDirection: 'row' },
  pairItem: { flex: 1, minWidth: 0 },
  boardHeading: { paddingHorizontal: RowInset, paddingTop: 12 },
  content: { alignSelf: 'center', flexGrow: 1, width: '100%' },
  readout: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    minHeight: 48,
    paddingHorizontal: RowInset,
  },
  readoutActive: { paddingRight: RowInset - 8 },
  readoutLabel: { flex: 1, justifyContent: 'center', minHeight: 48 },
  action: {
    alignItems: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 32,
    minWidth: 48,
    paddingHorizontal: 12,
  },
  actionLabel: { fontFamily: AppFonts.semibold },
  disabled: { opacity: 0.4 },
  rankRow: { gap: 6, paddingHorizontal: RowInset, paddingVertical: 8 },
  rankLine: { alignItems: 'baseline', flexDirection: 'row', gap: 10 },
  rankName: { flex: 1 },
  rankValue: { minWidth: 56, textAlign: 'right' },
  rankTrack: { borderRadius: 1, height: 3, overflow: 'hidden' },
  rankFill: { height: 3 },
  evalRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: RowInset,
    paddingVertical: 8,
  },
  evalName: { flex: 1, gap: 2 },
  evalValue: { minWidth: 44, textAlign: 'right' },
});

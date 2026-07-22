import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MotionPressable } from '@/components/motion-pressable';
import { PxiHeaderButton } from '@/components/pxi-header-button';
import { AppFonts, MaxContentWidth, Spacing, useAppColors } from '@/constants/theme';
import { type PhoenixSpan, usePhoenixProjects, usePhoenixTrace } from '@/hooks/use-phoenix-data';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';

type TimelineItem = {
  depth: number;
  span: PhoenixSpan;
};

type TokenCounts = {
  completion: number;
  prompt: number;
  total: number;
};

const IMPORTANT_ATTRIBUTES: { key: string; label: string }[] = [
  { key: 'llm.model_name', label: 'Model' },
  { key: 'gen_ai.request.model', label: 'Requested model' },
  { key: 'gen_ai.response.model', label: 'Response model' },
  { key: 'tool.name', label: 'Tool' },
  { key: 'session.id', label: 'Session' },
  { key: 'llm.token_count.prompt', label: 'Prompt tokens' },
  { key: 'llm.token_count.completion', label: 'Completion tokens' },
  { key: 'llm.token_count.total', label: 'Total tokens' },
  { key: 'input.value', label: 'Input' },
  { key: 'output.value', label: 'Output' },
];

export default function TraceDetailScreen() {
  const { id, projectId, traceId } = useLocalSearchParams<{ id: string; projectId: string; traceId: string }>();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const instance = useInstanceStore((state) => state.instances.find((candidate) => candidate.id === id));
  const projects = usePhoenixProjects(instance);
  const project = projects.data?.find((candidate) => candidate.id === projectId);
  const trace = usePhoenixTrace(instance, projectId, traceId);
  const spans = trace.data ?? [];
  const root = findRootSpan(spans);

  if (!instance) {
    return <UnavailableState message="This Phoenix connection is no longer on this device." title="Instance not found" />;
  }

  if (projects.isSuccess && !project) {
    return <UnavailableState message="This project is no longer available on the connected instance." title="Project not found" />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerBackTitle: project?.name ?? 'Traces',
          headerRight: () => <PxiHeaderButton instance={instance} />,
          title: root?.name ?? 'Trace',
          unstable_headerRightItems: () => [
            {
              element: <PxiHeaderButton instance={instance} />,
              type: 'custom',
            },
          ],
        }}
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 28 + insets.bottom }]}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            colors={[colors.brand]}
            onRefresh={() => trace.refetch()}
            progressBackgroundColor={colors.backgroundElement}
            refreshing={trace.isRefetching}
            tintColor={colors.brand}
          />
        }>
        {trace.isPending ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.accent} />
            <Text style={[styles.stateCopy, { color: colors.textSecondary }]}>Loading trace details...</Text>
          </View>
        ) : trace.isError ? (
          <View style={styles.centerState}>
            <Text style={[styles.stateTitle, { color: colors.text }]}>Couldn&apos;t load this trace</Text>
            <Text style={[styles.stateCopy, { color: colors.textSecondary }]}>{trace.error.message}</Text>
            <MotionPressable
              accessibilityRole="button"
              onPress={() => trace.refetch()}
              style={[styles.primaryButton, { backgroundColor: colors.accent }]}>
              <Text style={[styles.primaryButtonLabel, { color: colors.accentForeground }]}>Try again</Text>
            </MotionPressable>
          </View>
        ) : spans.length === 0 || !root ? (
          <View style={styles.centerState}>
            <Text style={[styles.stateTitle, { color: colors.text }]}>Trace not found</Text>
            <Text style={[styles.stateCopy, { color: colors.textSecondary }]}>Phoenix returned no spans for this trace.</Text>
          </View>
        ) : (
          <TraceContent instanceBaseUrl={instance.baseUrl} root={root} spans={spans} traceId={traceId} />
        )}
      </ScrollView>
    </View>
  );
}

function TraceContent({
  instanceBaseUrl,
  root,
  spans,
  traceId,
}: {
  instanceBaseUrl: string;
  root: PhoenixSpan;
  spans: PhoenixSpan[];
  traceId: string;
}) {
  const colors = useAppColors();
  const timeline = buildTimeline(spans);
  const traceStart = Math.min(...spans.map((span) => new Date(span.start_time).getTime()));
  const traceEnd = Math.max(...spans.map((span) => new Date(span.end_time).getTime()));
  const duration = Math.max(0, traceEnd - traceStart);
  const tokens = sumTokens(spans);
  const errors = spans.filter((span) => span.status_code === 'ERROR');
  const slowest = [...spans]
    .filter((span) => span.context.span_id !== root.context.span_id)
    .sort((left, right) => spanDuration(right) - spanDuration(left))[0];
  const largestTokenSpan = [...spans]
    .filter((span) => tokenCounts(span).total > 0)
    .sort((left, right) => tokenCounts(right).total - tokenCounts(left).total)[0];
  const status = errors.length > 0 || root.status_code === 'ERROR' ? 'ERROR' : root.status_code;

  return (
    <>
      <View style={styles.hero}>
        <View style={[styles.statusBadge, { backgroundColor: colors.backgroundSelected }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor(status, colors) }]} />
          <Text style={[styles.statusLabel, { color: statusColor(status, colors) }]}>{formatStatus(status)}</Text>
        </View>
        <Text style={[styles.title, { color: colors.text }]}>{root.name}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Started {formatDate(root.start_time)}</Text>
      </View>

      <View style={[styles.metrics, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
        <Metric label="Duration" value={formatDuration(duration)} />
        <Metric label="Spans" value={String(spans.length)} />
        <Metric label="Prompt" value={formatCount(tokens.prompt)} />
        <Metric label="Completion" value={formatCount(tokens.completion)} />
      </View>

      {(errors.length > 0 || slowest || largestTokenSpan) ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Needs attention</Text>
          <View style={[styles.attentionList, { borderColor: colors.border }]}>
            {errors[0] ? (
              <AttentionRow
                label={errors.length === 1 ? 'Error' : `${errors.length} errors`}
                span={errors[0]}
                value={errorSummary(errors[0])}
              />
            ) : null}
            {slowest ? <AttentionRow label="Slowest span" span={slowest} value={formatDuration(spanDuration(slowest))} /> : null}
            {largestTokenSpan ? (
              <AttentionRow
                label="Largest token use"
                span={largestTokenSpan}
                value={`${formatCount(tokenCounts(largestTokenSpan).total)} tokens`}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Execution</Text>
          <Text style={[styles.sectionMeta, { color: colors.textSecondary }]}>{spans.length} spans</Text>
        </View>
        <View style={[styles.timeline, { borderColor: colors.border }]}>
          {timeline.map((item) => (
            <SpanRow
              item={item}
              key={item.span.context.span_id}
              traceDuration={duration}
              traceStart={traceStart}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Trace actions</Text>
        <View style={styles.actions}>
          <MotionPressable
            accessibilityLabel="Copy trace ID"
            accessibilityRole="button"
            haptic="selection"
            onPress={() => void Clipboard.setStringAsync(traceId).then(haptics.success)}
            style={[styles.actionButton, { backgroundColor: colors.backgroundSelected, borderColor: colors.border }]}>
            <Text style={[styles.actionLabel, { color: colors.text }]}>Copy trace ID</Text>
          </MotionPressable>
          <MotionPressable
            accessibilityLabel="Open trace in Phoenix"
            accessibilityRole="button"
            onPress={() => void WebBrowser.openBrowserAsync(
              `${instanceBaseUrl.replace(/\/+$/, '')}/redirects/traces/${encodeURIComponent(traceId)}`
            )}
            style={[styles.actionButton, { backgroundColor: colors.backgroundSelected, borderColor: colors.border }]}>
            <Text style={[styles.actionLabel, { color: colors.text }]}>Open in Phoenix</Text>
          </MotionPressable>
        </View>
        <Text selectable style={[styles.traceId, { color: colors.textSecondary }]}>{traceId}</Text>
      </View>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const colors = useAppColors();
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

function AttentionRow({ label, span, value }: { label: string; span: PhoenixSpan; value: string }) {
  const colors = useAppColors();
  return (
    <View style={[styles.attentionRow, { borderBottomColor: colors.border }]}>
      <View style={styles.attentionCopy}>
        <Text style={[styles.attentionLabel, { color: colors.textSecondary }]}>{label}</Text>
        <Text numberOfLines={1} style={[styles.attentionName, { color: colors.text }]}>{span.name}</Text>
      </View>
      <Text numberOfLines={2} style={[styles.attentionValue, { color: span.status_code === 'ERROR' ? colors.danger : colors.textSecondary }]}>
        {value}
      </Text>
    </View>
  );
}

function SpanRow({
  item,
  traceDuration,
  traceStart,
}: {
  item: TimelineItem;
  traceDuration: number;
  traceStart: number;
}) {
  const colors = useAppColors();
  const [expanded, setExpanded] = useState(false);
  const [rawExpanded, setRawExpanded] = useState(false);
  const { depth, span } = item;
  const duration = spanDuration(span);
  const relativeStart = new Date(span.start_time).getTime() - traceStart;
  const left = traceDuration > 0 ? Math.min(96, Math.max(0, (relativeStart / traceDuration) * 100)) : 0;
  const width = traceDuration > 0 ? Math.min(100 - left, Math.max(4, (duration / traceDuration) * 100)) : 100;
  const importantAttributes = IMPORTANT_ATTRIBUTES.flatMap(({ key, label }) => {
    const value = span.attributes?.[key];
    return value == null ? [] : [{ key, label, value }];
  });
  const hasDetails = Boolean(span.status_message || importantAttributes.length > 0 || span.events?.length || span.attributes);

  return (
    <View style={[styles.spanRow, { borderBottomColor: colors.border }]}>
      <MotionPressable
        accessibilityHint={hasDetails ? 'Shows span details' : undefined}
        accessibilityLabel={`${span.name}, ${formatKind(span.span_kind)}, ${formatStatus(span.status_code)}, ${formatDuration(duration)}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        disabled={!hasDetails}
        onPress={() => setExpanded((current) => !current)}
        style={styles.spanPressable}>
        <View style={[styles.spanMain, { paddingLeft: Math.min(depth, 5) * 13 }]}>
          <View style={[styles.kindRail, { backgroundColor: kindColor(span.span_kind, colors) }]} />
          <View style={styles.spanCopy}>
            <View style={styles.spanTitleRow}>
              <Text numberOfLines={1} style={[styles.spanName, { color: colors.text }]}>{span.name}</Text>
              <Text style={[styles.spanDuration, { color: span.status_code === 'ERROR' ? colors.danger : colors.textSecondary }]}>
                {formatDuration(duration)}
              </Text>
              {hasDetails ? <Text style={[styles.disclosure, { color: colors.textSecondary }]}>{expanded ? '-' : '+'}</Text> : null}
            </View>
            <View style={styles.spanMetaRow}>
              <Text style={[styles.spanKind, { color: colors.textSecondary }]}>{formatKind(span.span_kind)}</Text>
              <Text style={[styles.spanStatus, { color: statusColor(span.status_code, colors) }]}>{formatStatus(span.status_code)}</Text>
              {tokenCounts(span).total > 0 ? (
                <Text style={[styles.spanKind, { color: colors.textSecondary }]}>{formatCount(tokenCounts(span).total)} tokens</Text>
              ) : null}
            </View>
            <View style={[styles.durationTrack, { backgroundColor: colors.backgroundSelected }]}>
              <View
                style={[
                  styles.durationBar,
                  {
                    backgroundColor: span.status_code === 'ERROR' ? colors.danger : kindColor(span.span_kind, colors),
                    left: `${left}%`,
                    width: `${width}%`,
                  },
                ]}
              />
            </View>
          </View>
        </View>
      </MotionPressable>

      {expanded ? (
        <View style={[styles.spanDetails, { backgroundColor: colors.backgroundSelected }]}>
          {span.status_message ? <DetailValue label="Status message" value={span.status_message} /> : null}
          {importantAttributes.map((attribute) => (
            <DetailValue key={attribute.key} label={attribute.label} value={formatValue(attribute.value)} />
          ))}
          {span.events?.map((event, index) => (
            <DetailValue
              key={`${event.timestamp}:${event.name}:${index}`}
              label={`${event.name} at ${formatTime(event.timestamp)}`}
              value={formatValue(event.attributes ?? {})}
            />
          ))}
          {span.attributes && Object.keys(span.attributes).length > 0 ? (
            <>
              <MotionPressable
                accessibilityRole="button"
                accessibilityState={{ expanded: rawExpanded }}
                onPress={() => setRawExpanded((current) => !current)}
                style={styles.rawButton}>
                <Text style={[styles.rawButtonLabel, { color: colors.text }]}>{rawExpanded ? 'Hide all attributes' : 'All attributes'}</Text>
                <Text style={[styles.disclosure, { color: colors.textSecondary }]}>{rawExpanded ? '-' : '+'}</Text>
              </MotionPressable>
              {rawExpanded ? (
                <Text selectable style={[styles.rawValue, { color: colors.textSecondary }]}>{formatValue(span.attributes)}</Text>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function DetailValue({ label, value }: { label: string; value: string }) {
  const colors = useAppColors();
  return (
    <View style={styles.detailValue}>
      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text selectable style={[styles.detailCopy, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

function UnavailableState({ message, title }: { message: string; title: string }) {
  const colors = useAppColors();
  return (
    <View style={[styles.centerState, styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Trace' }} />
      <Text style={[styles.stateTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.stateCopy, { color: colors.textSecondary }]}>{message}</Text>
    </View>
  );
}

function findRootSpan(spans: PhoenixSpan[]) {
  return spans.find((span) => span.parent_id == null) ?? [...spans].sort(compareStart)[0];
}

function buildTimeline(spans: PhoenixSpan[]): TimelineItem[] {
  const children = new Map<string | null, PhoenixSpan[]>();
  for (const span of spans) {
    const parentId = span.parent_id ?? null;
    children.set(parentId, [...(children.get(parentId) ?? []), span]);
  }
  for (const siblings of children.values()) siblings.sort(compareStart);

  const result: TimelineItem[] = [];
  const visited = new Set<string>();
  const visit = (span: PhoenixSpan, depth: number) => {
    if (visited.has(span.context.span_id)) return;
    visited.add(span.context.span_id);
    result.push({ depth, span });
    for (const child of children.get(span.context.span_id) ?? []) visit(child, depth + 1);
  };

  for (const root of children.get(null) ?? []) visit(root, 0);
  for (const span of [...spans].sort(compareStart)) visit(span, 0);
  return result;
}

function compareStart(left: PhoenixSpan, right: PhoenixSpan) {
  return new Date(left.start_time).getTime() - new Date(right.start_time).getTime();
}

function spanDuration(span: PhoenixSpan) {
  return Math.max(0, new Date(span.end_time).getTime() - new Date(span.start_time).getTime());
}

function numericAttribute(span: PhoenixSpan, key: string) {
  const value = span.attributes?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function tokenCounts(span: PhoenixSpan): TokenCounts {
  const prompt = numericAttribute(span, 'llm.token_count.prompt') || numericAttribute(span, 'gen_ai.usage.input_tokens');
  const completion = numericAttribute(span, 'llm.token_count.completion') || numericAttribute(span, 'gen_ai.usage.output_tokens');
  const total = numericAttribute(span, 'llm.token_count.total') || prompt + completion;
  return { completion, prompt, total };
}

function sumTokens(spans: PhoenixSpan[]): TokenCounts {
  const tokenSpans = spans.filter((span) => span.span_kind.toUpperCase() === 'LLM');
  return (tokenSpans.length > 0 ? tokenSpans : spans).reduce<TokenCounts>((total, span) => {
    const counts = tokenCounts(span);
    return {
      completion: total.completion + counts.completion,
      prompt: total.prompt + counts.prompt,
      total: total.total + counts.total,
    };
  }, { completion: 0, prompt: 0, total: 0 });
}

function errorSummary(span: PhoenixSpan) {
  const exception = span.events?.find((event) => event.name.toLowerCase() === 'exception');
  const message = exception?.attributes?.['exception.message'];
  if (typeof message === 'string' && message) return message;
  return span.status_message || 'Error status';
}

function formatValue(value: unknown) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 1) return '<1 ms';
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 10_000) return `${(milliseconds / 1000).toFixed(1)} s`;
  return `${Math.round(milliseconds / 1000)} s`;
}

function formatCount(value: number) {
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}m`;
}

function formatKind(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function formatStatus(value: string) {
  if (value === 'ERROR') return 'Error';
  if (value === 'OK') return 'OK';
  return 'Unset';
}

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    second: '2-digit',
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function statusColor(status: string, colors: ReturnType<typeof useAppColors>) {
  if (status === 'ERROR') return colors.danger;
  if (status === 'OK') return colors.success;
  return colors.textSecondary;
}

function kindColor(kind: string, colors: ReturnType<typeof useAppColors>) {
  const normalized = kind.toUpperCase();
  if (normalized === 'LLM' || normalized === 'AGENT') return colors.brand;
  if (normalized === 'TOOL' || normalized === 'RETRIEVER') return colors.brandSecondary;
  return colors.textSecondary;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { alignSelf: 'center', maxWidth: MaxContentWidth, paddingHorizontal: 20, paddingTop: 18, width: '100%' },
  centerState: { alignItems: 'center', gap: 10, justifyContent: 'center', minHeight: 360, padding: 28 },
  stateTitle: { fontFamily: AppFonts.semibold, fontSize: 20 },
  stateCopy: { fontFamily: AppFonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  primaryButton: { borderRadius: 16, minHeight: 48, justifyContent: 'center', marginTop: 8, paddingHorizontal: 20 },
  primaryButtonLabel: { fontFamily: AppFonts.semibold, fontSize: 15 },
  hero: { alignItems: 'flex-start', gap: 8, paddingBottom: 24 },
  statusBadge: { alignItems: 'center', borderRadius: 999, flexDirection: 'row', gap: 7, minHeight: 30, paddingHorizontal: 11 },
  statusDot: { borderRadius: 5, height: 8, width: 8 },
  statusLabel: { fontFamily: AppFonts.semibold, fontSize: 13 },
  title: { fontFamily: AppFonts.semibold, fontSize: 32, letterSpacing: -1, lineHeight: 38 },
  subtitle: { fontFamily: AppFonts.regular, fontSize: 14 },
  metrics: { borderRadius: 22, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', overflow: 'hidden', paddingVertical: 4 },
  metric: { flexBasis: '50%', gap: 4, maxWidth: '50%', paddingHorizontal: 18, paddingVertical: 14 },
  metricLabel: { fontFamily: AppFonts.medium, fontSize: 12, textTransform: 'uppercase' },
  metricValue: { fontFamily: AppFonts.semibold, fontSize: 20 },
  section: { gap: 12, paddingTop: 30 },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: AppFonts.semibold, fontSize: 20, letterSpacing: -0.3 },
  sectionMeta: { fontFamily: AppFonts.medium, fontSize: 13 },
  attentionList: { borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  attentionRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 14, minHeight: 70, paddingHorizontal: 16, paddingVertical: 12 },
  attentionCopy: { flex: 1, gap: 3 },
  attentionLabel: { fontFamily: AppFonts.medium, fontSize: 12, textTransform: 'uppercase' },
  attentionName: { fontFamily: AppFonts.semibold, fontSize: 15 },
  attentionValue: { fontFamily: AppFonts.medium, fontSize: 13, maxWidth: '42%', textAlign: 'right' },
  timeline: { borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  spanRow: { borderBottomWidth: StyleSheet.hairlineWidth },
  spanPressable: { minHeight: 82, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  spanMain: { flexDirection: 'row', gap: 10 },
  kindRail: { borderRadius: 2, width: 3 },
  spanCopy: { flex: 1, gap: 7 },
  spanTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  spanName: { flex: 1, fontFamily: AppFonts.semibold, fontSize: 15 },
  spanDuration: { fontFamily: AppFonts.medium, fontSize: 12 },
  disclosure: { fontFamily: AppFonts.medium, fontSize: 20, textAlign: 'center', width: 18 },
  spanMetaRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  spanKind: { fontFamily: AppFonts.medium, fontSize: 11, textTransform: 'uppercase' },
  spanStatus: { fontFamily: AppFonts.semibold, fontSize: 11, textTransform: 'uppercase' },
  durationTrack: { borderRadius: 3, height: 5, overflow: 'hidden', position: 'relative' },
  durationBar: { borderRadius: 3, bottom: 0, position: 'absolute', top: 0 },
  spanDetails: { gap: 16, paddingBottom: 18, paddingHorizontal: 18, paddingTop: 16 },
  detailValue: { gap: 5 },
  detailLabel: { fontFamily: AppFonts.medium, fontSize: 12, textTransform: 'uppercase' },
  detailCopy: { fontFamily: AppFonts.regular, fontSize: 14, lineHeight: 20 },
  rawButton: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 48 },
  rawButtonLabel: { fontFamily: AppFonts.semibold, fontSize: 14 },
  rawValue: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: Spacing.two },
  actionButton: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 50, paddingHorizontal: 10 },
  actionLabel: { fontFamily: AppFonts.semibold, fontSize: 14 },
  traceId: { fontFamily: 'monospace', fontSize: 11, lineHeight: 16, paddingHorizontal: 4 },
});

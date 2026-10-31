import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/empty-state';
import { ListRow, RowInset, RowSeparator } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { StatusLabel, type StatusTone } from '@/components/ui/status-label';
import { Type, useAppColors } from '@/constants/theme';
import { useContentColumnStyle } from '@/features/duo/layout';
import { type PhoenixSpan, usePhoenixProjects, usePhoenixTrace } from '@/hooks/use-phoenix-data';
import { formatCompactNumber, formatDuration, formatRelativeTime } from '@/lib/format';
import { useInstanceStore } from '@/store/instances';

import { SpanTree } from './span-tree';
import { copyId, openTraceInPhoenix } from './trace-detail-actions';
import {
  buildTimeline,
  errorSummary,
  findRootSpan,
  primaryError,
  shortId,
  spanAttributes,
  stringAttribute,
  sumTokens,
  traceWindow,
} from './trace-detail-model';
import { ContentValue, type KeyValue, KeyValueList } from './trace-detail-rows';

export { findRootSpan } from './trace-detail-model';

/**
 * The trace detail body: the root span's name and one line of figures, the
 * error if there is one, the trace's input and output, the span waterfall,
 * and the trace's identifiers. The trace route renders it in its own column;
 * the project feed renders it `embedded` as the secondary pane of a split.
 *
 * The selected span can be owned by the caller (`selectedSpanId` and
 * `onSelectSpan`), so a route can offer "Copy span ID" in its bar. Set
 * `actionsInBar` when the caller shows the trace actions as bar items; the
 * page then drops its own action rows.
 */
export function TraceDetailView({
  actionsInBar = false,
  instanceId,
  onSelectSpan,
  projectId,
  selectedSpanId,
  traceId,
}: {
  /** Accepted for the project feed's split pane; the page reads the same either way. */
  embedded?: boolean;
  instanceId: string;
  projectId: string;
  traceId: string;
  selectedSpanId?: string | null;
  onSelectSpan?: (spanId: string | null) => void;
  actionsInBar?: boolean;
}) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const column = useContentColumnStyle(0);
  const [localSelection, setLocalSelection] = useState<string | null>(null);
  const selection = selectedSpanId === undefined ? localSelection : selectedSpanId;
  const select = onSelectSpan ?? setLocalSelection;

  const instance = useInstanceStore((state) =>
    state.instances.find((candidate) => candidate.id === instanceId),
  );

  const projects = usePhoenixProjects(instance);
  const project = projects.data?.find((candidate) => candidate.id === projectId);
  const trace = usePhoenixTrace(instance, projectId, traceId);
  const spans = trace.data ?? [];
  const root = findRootSpan(spans);

  if (!instance) {
    return (
      <EmptyState
        message="This Phoenix connection is no longer on this device."
        symbol={{ android: 'cloud_off', ios: 'externaldrive.badge.xmark', web: 'cloud_off' }}
        title="Instance not found"
      />
    );
  }

  if (projects.isSuccess && !project) {
    return (
      <EmptyState
        message="This project is no longer available on the connected instance."
        symbol={{ android: 'folder_off', ios: 'folder.badge.questionmark', web: 'folder_off' }}
        title="Project not found"
      />
    );
  }

  if (trace.isPending) return <EmptyState loading title="Loading trace" />;

  if (trace.isError) {
    return (
      <EmptyState
        action={{ label: 'Try again', onPress: () => void trace.refetch() }}
        message={trace.error.message}
        symbol={{ android: 'wifi_off', ios: 'wifi.exclamationmark', web: 'wifi_off' }}
        title="Couldn’t load this trace"
      />
    );
  }

  if (!root) {
    return (
      <EmptyState
        action={{ label: 'Refresh', onPress: () => void trace.refetch() }}
        message="Phoenix returned no spans for this trace. Recent traces can take a moment to arrive."
        symbol={{ android: 'search_off', ios: 'magnifyingglass', web: 'search_off' }}
        title="Trace not found"
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.content, column, { paddingBottom: 28 + insets.bottom }]}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl
          colors={[colors.textSecondary]}
          onRefresh={() => void trace.refetch()}
          progressBackgroundColor={colors.backgroundElement}
          refreshing={trace.isRefetching}
          tintColor={colors.textSecondary}
        />
      }
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <TraceContent
        actionsInBar={actionsInBar}
        baseUrl={instance.baseUrl}
        onSelectSpan={select}
        root={root}
        selectedSpanId={selection}
        spans={spans}
        traceId={traceId}
      />
    </ScrollView>
  );
}

function TraceContent({
  actionsInBar,
  baseUrl,
  onSelectSpan,
  root,
  selectedSpanId,
  spans,
  traceId,
}: {
  actionsInBar: boolean;
  baseUrl: string;
  root: PhoenixSpan;
  spans: PhoenixSpan[];
  traceId: string;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string | null) => void;
}) {
  const window = traceWindow(spans);
  const timeline = buildTimeline(spans, window);
  const tokens = sumTokens(spans);
  const error = primaryError(spans, root);
  const errorCount = spans.filter((span) => span.status_code === 'ERROR').length;
  const input = spanAttributes(root)?.['input.value'];
  const output = spanAttributes(root)?.['output.value'];

  const status: StatusTone =
    errorCount > 0 ? 'error' : root.status_code === 'OK' ? 'ok' : 'neutral';

  return (
    <>
      <TraceHeader
        duration={window.duration}
        error={error}
        errorCount={errorCount}
        root={root}
        status={status}
        tokens={tokens.total}
        traceId={traceId}
      />

      {input != null ? (
        <>
          <SectionHeader label="Input" />
          <View style={styles.payload}>
            <ContentValue value={input} />
          </View>
        </>
      ) : null}

      {output != null ? (
        <>
          <SectionHeader label="Output" />
          <View style={styles.payload}>
            <ContentValue value={output} />
          </View>
        </>
      ) : null}

      <SectionHeader label={`Spans (${spans.length})`} />
      <SpanTree
        items={timeline}
        onSelect={onSelectSpan}
        selectedSpanId={selectedSpanId}
        window={window}
      />

      <SectionHeader label="Details" />
      <KeyValueList rows={detailRows(root, traceId, spans.length, tokens)} />

      {actionsInBar ? null : (
        <TraceActions baseUrl={baseUrl} selectedSpanId={selectedSpanId} traceId={traceId} />
      )}
    </>
  );
}

function TraceHeader({
  duration,
  error,
  errorCount,
  root,
  status,
  tokens,
  traceId,
}: {
  root: PhoenixSpan;
  status: StatusTone;
  duration: number;
  tokens: number;
  traceId: string;
  error: PhoenixSpan | undefined;
  errorCount: number;
}) {
  const colors = useAppColors();
  const started = formatRelativeTime(root.start_time);
  const startedLabel = /^\d+[mhd]$/.test(started) ? `${started} ago` : started;
  const statusWord = status === 'error' ? 'Error' : status === 'ok' ? 'OK' : 'Unset';
  const meta = [{ key: 'duration', text: formatDuration(duration) }];

  if (tokens > 0) meta.push({ key: 'tokens', text: `${formatCompactNumber(tokens)} tok` });
  meta.push({ key: 'id', text: shortId(traceId) }, { key: 'started', text: startedLabel });

  const errorSource =
    error && error.context.span_id !== root.context.span_id ? `in ${error.name}` : null;

  const moreErrors = errorCount > 1 ? `${errorCount} spans failed` : null;
  const errorContext = [errorSource, moreErrors].filter((part) => part !== null).join(' · ');

  return (
    <View style={styles.header}>
      <Text selectable style={[Type.title, { color: colors.text }]}>
        {root.name}
      </Text>
      <View
        accessible
        accessibilityLabel={`${statusWord}, ${formatDuration(duration)}${
          tokens > 0 ? `, ${formatCompactNumber(tokens)} tokens` : ''
        }, started ${startedLabel}`}
        style={styles.meta}
      >
        {/* Unset is the usual state of a root span; only OK and Error say something. */}
        {status === 'ok' || status === 'error' ? (
          <StatusLabel label={statusWord} tone={status} />
        ) : null}
        {meta.map((part) => (
          <Text
            key={part.key}
            numberOfLines={1}
            style={[Type.mono, { color: colors.textSecondary }]}
          >
            {part.text}
          </Text>
        ))}
      </View>
      {error ? (
        <View style={styles.error}>
          <Text selectable style={[Type.body, { color: colors.danger }]}>
            {errorSummary(error)}
          </Text>
          {errorContext ? (
            <Text style={[Type.mono, { color: colors.textSecondary }]}>{errorContext}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function detailRows(
  root: PhoenixSpan,
  traceId: string,
  spanCount: number,
  tokens: ReturnType<typeof sumTokens>,
): KeyValue[] {
  const rows: KeyValue[] = [
    { key: 'trace-id', label: 'Trace ID', mono: true, value: traceId },
    { key: 'root-span-id', label: 'Root span ID', mono: true, value: root.context.span_id },
    {
      key: 'started',
      label: 'Started',
      mono: true,
      value: new Date(root.start_time).toLocaleString([], {
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        month: 'short',
        second: '2-digit',
      }),
    },
    { key: 'spans', label: 'Spans', mono: true, value: String(spanCount) },
  ];

  if (tokens.total > 0) {
    rows.push(
      { key: 'prompt', label: 'Prompt tokens', mono: true, value: tokens.prompt.toLocaleString() },
      {
        key: 'completion',
        label: 'Completion tokens',
        mono: true,
        value: tokens.completion.toLocaleString(),
      },
    );
  }

  const model = stringAttribute(root, 'llm.model_name');

  if (model) rows.push({ key: 'model', label: 'Model', value: model });
  const session = stringAttribute(root, 'session.id');

  if (session) rows.push({ key: 'session', label: 'Session', mono: true, value: session });

  return rows;
}

/** Android, web, and the project feed's split pane keep the bar's actions as rows. */
function TraceActions({
  baseUrl,
  selectedSpanId,
  traceId,
}: {
  baseUrl: string;
  traceId: string;
  selectedSpanId: string | null;
}) {
  const colors = useAppColors();

  const glyph = (name: SymbolViewProps['name']) => (
    <SymbolView name={name} size={16} tintColor={colors.text} />
  );

  return (
    <>
      <SectionHeader label="Actions" />
      <ListRow
        leading={glyph({ android: 'content_copy', ios: 'doc.on.doc', web: 'content_copy' })}
        meta={shortId(traceId)}
        onPress={() => copyId(traceId)}
        title="Copy trace ID"
        variant="flat"
      />
      {selectedSpanId ? (
        <>
          <RowSeparator inset={RowInset + 30} />
          <ListRow
            leading={glyph({ android: 'tag', ios: 'number', web: 'tag' })}
            meta={shortId(selectedSpanId)}
            onPress={() => copyId(selectedSpanId)}
            title="Copy span ID"
            variant="flat"
          />
        </>
      ) : null}
      <RowSeparator inset={RowInset + 30} />
      <ListRow
        accessibilityLabel="Open trace in Phoenix"
        leading={glyph({ android: 'open_in_new', ios: 'safari', web: 'open_in_new' })}
        onPress={() => openTraceInPhoenix(baseUrl, traceId)}
        title="Open in Phoenix"
        variant="flat"
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { alignSelf: 'center', width: '100%' },
  header: { gap: 8, paddingBottom: 6, paddingHorizontal: RowInset, paddingTop: 12 },
  meta: {
    alignItems: 'center',
    columnGap: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 4,
  },
  error: { gap: 2, paddingTop: 4 },
  payload: { paddingBottom: 6, paddingHorizontal: RowInset, paddingTop: 4 },
});

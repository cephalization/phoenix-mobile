import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';

import { JsonBlock } from '@/components/json-block';
import { RowInset, RowSeparator } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { StatusLabel } from '@/components/ui/status-label';
import { AppFonts, Type, useAppColors } from '@/constants/theme';
import type { PhoenixSpan } from '@/hooks/use-phoenix-data';
import { formatCompactNumber, formatDuration } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { isJsonObject, type JsonValue } from '@/lib/json';

import {
  formatKind,
  formatStatus,
  isErrorSpan,
  spanAttributes,
  spanDuration,
  spanOffset,
  type TimelineItem,
  tokenCounts,
  type TraceWindow,
} from './trace-detail-model';
import { type KeyValue, KeyValueList } from './trace-detail-rows';

/** Indentation per tree level, capped so deep trees keep room for names. */
const INDENT = 12;
const MAX_INDENT_DEPTH = 8;

/** Span attributes worth reading without opening the full attribute JSON. */
const NOTABLE_ATTRIBUTES: { key: string; label: string; mono?: boolean }[] = [
  { key: 'llm.model_name', label: 'Model' },
  { key: 'gen_ai.request.model', label: 'Requested model' },
  { key: 'gen_ai.response.model', label: 'Response model' },
  { key: 'tool.name', label: 'Tool' },
  { key: 'session.id', label: 'Session', mono: true },
  { key: 'input.value', label: 'Input' },
  { key: 'output.value', label: 'Output' },
];

/**
 * The span waterfall: one flat row per span, indented by depth, with a thin
 * bar placed on the shared trace timeline. Tapping a row selects it and opens
 * its details in place; tapping it again closes them.
 */
export function SpanTree({
  items,
  onSelect,
  selectedSpanId,
  window,
}: {
  items: TimelineItem[];
  window: TraceWindow;
  selectedSpanId: string | null;
  onSelect: (spanId: string | null) => void;
}) {
  return (
    <View>
      {items.map((item, index) => {
        const spanId = item.span.context.span_id;
        const selected = spanId === selectedSpanId;

        return (
          <View key={spanId}>
            {index > 0 ? <RowSeparator /> : null}
            <SpanRow
              item={item}
              onPress={() => onSelect(selected ? null : spanId)}
              selected={selected}
            />
            {selected ? <SpanDetails span={item.span} window={window} /> : null}
          </View>
        );
      })}
    </View>
  );
}

function SpanRow({
  item,
  onPress,
  selected,
}: {
  item: TimelineItem;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useAppColors();
  const { depth, extent, offset, span } = item;
  const error = isErrorSpan(span);
  const duration = formatDuration(spanDuration(span));
  const kind = formatKind(span.span_kind);

  const barColor = error ? colors.danger : selected ? colors.text : colors.textTertiary;

  return (
    <Pressable
      accessibilityHint={selected ? 'Hides span details' : 'Shows span details'}
      accessibilityLabel={`${span.name}, ${kind}, ${formatStatus(span.status_code)}, ${duration}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: selected, selected }}
      android_ripple={{ color: colors.ripple }}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      style={({ pressed }) => [
        styles.row,
        (selected || pressed) && { backgroundColor: colors.rowSelected },
      ]}
    >
      <View style={[styles.line, { paddingLeft: Math.min(depth, MAX_INDENT_DEPTH) * INDENT }]}>
        {error ? <StatusLabel size={11} tone="error" /> : null}
        <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
          {span.name}
        </Text>
        <Text numberOfLines={1} style={[Type.label, { color: colors.textTertiary }]}>
          {kind}
        </Text>
        <Text
          numberOfLines={1}
          style={[
            Type.mono,
            styles.duration,
            { color: error ? colors.danger : colors.textSecondary },
          ]}
        >
          {duration}
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.separator }]}>
        <View
          style={[
            styles.bar,
            { backgroundColor: barColor, left: `${offset * 100}%`, width: `${extent * 100}%` },
          ]}
        />
      </View>
    </Pressable>
  );
}

function SpanDetails({ span, window }: { span: PhoenixSpan; window: TraceWindow }) {
  const [attributesExpanded, setAttributesExpanded] = useState(false);
  const attributes = spanAttributes(span);
  const attributeCount = attributes ? Object.keys(attributes).length : 0;
  const tokens = tokenCounts(span);
  const error = isErrorSpan(span);

  const rows: KeyValue[] = [
    { key: 'span-id', label: 'Span ID', mono: true, value: span.context.span_id },
    { key: 'kind', label: 'Kind', value: formatKind(span.span_kind) },
    {
      key: 'status',
      label: 'Status',
      tone: error ? 'danger' : 'default',
      value: formatStatus(span.status_code),
    },
  ];

  if (span.status_message) {
    rows.push({
      key: 'status-message',
      label: 'Message',
      tone: error ? 'danger' : 'default',
      value: span.status_message,
    });
  }

  rows.push(
    {
      key: 'start',
      label: 'Starts at',
      mono: true,
      value: `+${formatDuration(spanOffset(span, window))}`,
    },
    { key: 'duration', label: 'Duration', mono: true, value: formatDuration(spanDuration(span)) },
  );

  if (tokens.total > 0) {
    rows.push({
      key: 'tokens',
      label: 'Tokens',
      mono: true,
      value: `${formatCompactNumber(tokens.prompt)} in · ${formatCompactNumber(tokens.completion)} out`,
    });
  }

  for (const { key, label, mono } of NOTABLE_ATTRIBUTES) {
    const value = attributes?.[key];

    if (value != null) rows.push({ key, label, mono, value });
  }

  eventEntries(span.events ?? []).forEach(({ event, key }) => {
    const value: JsonValue = isJsonObject(event.attributes) ? event.attributes : {};
    const at = formatDuration(Math.max(0, new Date(event.timestamp).getTime() - window.start));

    rows.push({ key: `event:${key}`, label: `${event.name} +${at}`, value });
  });

  return (
    <View accessibilityLabel={`${span.name} details`}>
      <RowSeparator />
      <KeyValueList rows={rows} />
      {attributes && attributeCount > 0 ? (
        <>
          <SectionHeader
            count={attributeCount}
            expanded={attributesExpanded}
            label="All attributes"
            onToggle={() => setAttributesExpanded((current) => !current)}
          />
          {attributesExpanded ? (
            <View style={styles.attributes}>
              <JsonBlock maxHeight={420} value={attributes} />
            </View>
          ) : null}
        </>
      ) : null}
      <View style={styles.detailsEnd} />
    </View>
  );
}

type SpanEvent = NonNullable<PhoenixSpan['events']>[number];

/** Keys events by timestamp and name, disambiguating repeats without relying on list position. */
function eventEntries(events: SpanEvent[]): { event: SpanEvent; key: string }[] {
  const seen = new Map<string, number>();

  return events.map((event) => {
    const base = `${event.timestamp}:${event.name}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);

    return { event, key: occurrence === 0 ? base : `${base}#${occurrence}` };
  });
}

const styles = StyleSheet.create({
  row: {
    gap: 7,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: RowInset,
    paddingVertical: 10,
  },
  line: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  name: { flex: 1, fontFamily: AppFonts.medium, fontSize: 15, lineHeight: 20, minWidth: 0 },
  duration: { minWidth: 52, textAlign: 'right' },
  track: { borderRadius: 1, height: 2, overflow: 'hidden' },
  bar: { borderRadius: 1, bottom: 0, minWidth: 2, position: 'absolute', top: 0 },
  attributes: { paddingBottom: 12, paddingHorizontal: RowInset },
  detailsEnd: { height: 8 },
});

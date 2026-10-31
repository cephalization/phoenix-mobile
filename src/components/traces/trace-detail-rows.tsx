import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { isJsonBlockValue, JsonBlock } from '@/components/json-block';
import { RowInset, RowSeparator } from '@/components/ui/list-row';
import { Type, useAppColors } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { isJsonString, type JsonValue } from '@/lib/json';

/** Text longer than this shows a preview with a Show all toggle. */
const PREVIEW_LENGTH = 1_500;

/** Longest text rendered at all; Phoenix payloads can run to megabytes. */
const MAX_TEXT_LENGTH = 50_000;

/** A value that reads inline beside its label; anything longer stacks below it. */
const INLINE_LENGTH = 72;

export type KeyValue = {
  key: string;
  label: string;
  value: JsonValue;
  /** IDs, figures, and times line up in the monospaced face. */
  mono?: boolean;
  tone?: 'default' | 'danger';
};

/** Flat label and value rows divided by hairlines. Values are selectable. */
export function KeyValueList({ inset = RowInset, rows }: { rows: KeyValue[]; inset?: number }) {
  return (
    <View>
      {rows.map((row, index) => (
        <View key={row.key}>
          {index > 0 ? <RowSeparator inset={inset} /> : null}
          <KeyValueRow inset={inset} row={row} />
        </View>
      ))}
    </View>
  );
}

function KeyValueRow({ inset, row }: { inset: number; row: KeyValue }) {
  const colors = useAppColors();
  const text = isJsonString(row.value) ? row.value : null;
  const inline = text !== null && text.length <= INLINE_LENGTH && !text.includes('\n');

  const label = (
    <Text style={[Type.subhead, styles.label, { color: colors.textSecondary }]}>{row.label}</Text>
  );

  if (inline) {
    return (
      <View
        accessible
        accessibilityLabel={`${row.label}, ${text}`}
        style={[styles.inlineRow, { paddingLeft: inset }]}
      >
        {label}
        <Text
          selectable
          style={[
            row.mono ? Type.mono : Type.subhead,
            styles.inlineValue,
            { color: row.tone === 'danger' ? colors.danger : colors.text },
          ]}
        >
          {text}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.stackedRow, { paddingLeft: inset }]}>
      {label}
      <ContentValue mono={row.mono} tone={row.tone} value={row.value} />
    </View>
  );
}

/**
 * A payload: a JSON block when it is structured, otherwise selectable text
 * with a preview for long values. Used for trace input and output and for
 * long span attributes.
 */
export function ContentValue({
  mono = false,
  tone = 'default',
  value,
}: {
  value: JsonValue;
  mono?: boolean;
  tone?: 'default' | 'danger';
}) {
  const colors = useAppColors();
  const [expanded, setExpanded] = useState(false);

  // Objects, arrays, and strings that parse to one keep the code background.
  if (!isJsonString(value) || isJsonBlockValue(value)) {
    return <JsonBlock maxHeight={320} value={value} />;
  }

  const text = value;
  const long = text.length > PREVIEW_LENGTH;
  const limit = expanded ? MAX_TEXT_LENGTH : PREVIEW_LENGTH;
  const display = text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;

  return (
    <View style={styles.content}>
      <Text
        selectable
        style={[
          mono ? Type.mono : Type.body,
          { color: tone === 'danger' ? colors.danger : colors.text },
        ]}
      >
        {display}
      </Text>
      {long ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          hitSlop={4}
          onPress={() => {
            haptics.selection();
            setExpanded((current) => !current);
          }}
          style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
        >
          <Text style={[Type.label, { color: colors.text }]}>
            {expanded ? 'Show less' : 'Show all'}
          </Text>
          <Text style={[Type.mono, { color: colors.textTertiary }]}>
            {expanded && text.length > MAX_TEXT_LENGTH
              ? `first ${MAX_TEXT_LENGTH.toLocaleString()} of ${text.length.toLocaleString()} chars`
              : `${text.length.toLocaleString()} chars`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inlineRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 12,
    minHeight: 44,
    paddingRight: RowInset,
    paddingVertical: 12,
  },
  label: { width: 112 },
  inlineValue: { flex: 1, textAlign: 'right' },
  stackedRow: { gap: 8, paddingRight: RowInset, paddingVertical: 12 },
  content: { gap: 4 },
  toggle: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    minHeight: 48,
  },
  pressed: { opacity: 0.55 },
});

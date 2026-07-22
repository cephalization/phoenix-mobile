import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Fonts, useAppColors } from '@/constants/theme';

const MAX_JSON_LENGTH = 25_000;
const JSON_TOKEN_PATTERN = /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b/g;

export function isJsonValue(value: unknown) {
  if (typeof value === 'object' && value !== null) return true;
  if (typeof value !== 'string') return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
}

export function JsonBlock({
  maxHeight = 260,
  onInteraction,
  value,
}: {
  maxHeight?: number;
  onInteraction?: () => void;
  value: unknown;
}) {
  const colors = useAppColors();
  const json = serializeJson(value);

  return (
    <View
      accessibilityLabel="JSON data"
      style={[styles.block, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
      <View style={[styles.header, { backgroundColor: colors.backgroundSelected, borderBottomColor: colors.border }]}>
        <Text style={[styles.language, { color: colors.textSecondary }]}>JSON</Text>
        {json.truncated ? <Text style={[styles.truncated, { color: colors.textSecondary }]}>Truncated</Text> : null}
      </View>
      <ScrollView
        contentContainerStyle={styles.verticalContent}
        nestedScrollEnabled
        onScrollBeginDrag={onInteraction}
        showsVerticalScrollIndicator
        style={{ maxHeight }}>
        <ScrollView
          contentContainerStyle={styles.horizontalContent}
          horizontal
          nestedScrollEnabled
          onScrollBeginDrag={onInteraction}
          showsHorizontalScrollIndicator>
          <Text selectable style={[styles.code, { color: colors.text }]}>
            {highlightJson(json.text, colors)}
          </Text>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

function serializeJson(value: unknown) {
  let normalized = value;
  if (typeof value === 'string') {
    try {
      normalized = JSON.parse(value);
    } catch {
      normalized = value;
    }
  }

  let text: string;
  try {
    text = typeof normalized === 'string' ? normalized : JSON.stringify(normalized, null, 2);
  } catch {
    text = 'JSON value could not be displayed.';
  }

  if (text.length <= MAX_JSON_LENGTH) return { text, truncated: false };
  return { text: `${text.slice(0, MAX_JSON_LENGTH)}\n...`, truncated: true };
}

function highlightJson(text: string, colors: ReturnType<typeof useAppColors>) {
  const children: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(JSON_TOKEN_PATTERN)) {
    const index = match.index;
    if (index > cursor) children.push(text.slice(cursor, index));

    const token = match[0];
    const afterToken = text.slice(index + token.length);
    const isKey = token.startsWith('"') && /^\s*:/.test(afterToken);
    const color = isKey
      ? colors.brand
      : token.startsWith('"')
        ? colors.success
        : token === 'true' || token === 'false'
          ? colors.danger
          : token === 'null'
            ? colors.textSecondary
            : colors.brandSecondary;
    children.push(<Text key={`${index}:${token.length}`} style={{ color }}>{token}</Text>);
    cursor = index + token.length;
  }

  if (cursor < text.length) children.push(text.slice(cursor));
  return children;
}

const styles = StyleSheet.create({
  block: { borderRadius: 11, borderWidth: 1, overflow: 'hidden' },
  header: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 32, paddingHorizontal: 11 },
  language: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 0.7 },
  truncated: { fontFamily: Fonts.mono, fontSize: 10 },
  verticalContent: { flexGrow: 0 },
  horizontalContent: { minWidth: '100%', padding: 12 },
  code: { fontFamily: Fonts.mono, fontSize: 12, lineHeight: 18 },
});

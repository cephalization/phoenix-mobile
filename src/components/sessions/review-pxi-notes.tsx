import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MessageMarkdown } from '@/components/chat/message-markdown';
import { PxiGlyph } from '@/components/pxi-glyph';
import { EmptyState } from '@/components/ui/empty-state';
import { RowInset, RowSeparator } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { Type, useAppColors } from '@/constants/theme';
import type { SessionTurn, SpanNoteAnnotation } from '@/features/session-review/types';
import type { usePhoenixSessionPxiNotes } from '@/hooks/use-phoenix-sessions';
import { formatRelativeTime } from '@/lib/format';

// Notes lead with a one-sentence code summary (part of the investigate-session
// prompt contract), so the collapsed preview reads as a labeled finding.
const PREVIEW_LINES = 4;
const PREVIEW_THRESHOLD = 320;

/** PXI's open-coding notes on the session's turns, in turn order. */
export function PxiNotesSection({
  notes,
  turns,
}: {
  notes: ReturnType<typeof usePhoenixSessionPxiNotes>;
  turns: SessionTurn[];
}) {
  const colors = useAppColors();
  const [expanded, setExpanded] = useState(true);
  const turnIndexBySpanId = new Map<string, number>();

  turns.forEach((turn, index) => {
    if (turn.rootSpan) turnIndexBySpanId.set(turn.rootSpan.context.span_id, index);
  });

  const data = [...(notes.data ?? [])].sort(
    (left, right) =>
      (turnIndexBySpanId.get(left.span_id) ?? Number.MAX_SAFE_INTEGER) -
      (turnIndexBySpanId.get(right.span_id) ?? Number.MAX_SAFE_INTEGER),
  );

  if (!notes.isError && data.length === 0) return null;

  return (
    <View>
      <SectionHeader
        count={data.length}
        expanded={expanded}
        label="PXI notes"
        onToggle={() => setExpanded((current) => !current)}
      />
      {!expanded ? null : notes.isError ? (
        <EmptyState
          action={{ label: 'Try again', onPress: () => void notes.refetch() }}
          fill={false}
          message={notes.error.message}
          title="Couldn’t load PXI notes"
        />
      ) : (
        <>
          {data.map((note, index) => {
            const turnIndex = turnIndexBySpanId.get(note.span_id);

            return (
              <View key={note.id}>
                {index > 0 ? <RowSeparator /> : null}
                <PxiNote
                  note={note}
                  title={turnIndex != null ? `Turn ${turnIndex + 1}` : 'Session'}
                />
              </View>
            );
          })}
          <Text style={[Type.subhead, styles.hint, { color: colors.textTertiary }]}>
            Weigh PXI’s notes against the conversation. They never mark a session reviewed.
          </Text>
        </>
      )}
    </View>
  );
}

function PxiNote({ note, title }: { note: SpanNoteAnnotation; title: string }) {
  const colors = useAppColors();
  const [expanded, setExpanded] = useState(false);
  const text = note.result?.explanation ?? '';
  const collapsible = text.length > PREVIEW_THRESHOLD;

  return (
    <View style={styles.note}>
      <View style={styles.noteHeader}>
        <PxiGlyph color={colors.brand} size={12} />
        <Text style={[Type.label, styles.noteTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[Type.mono, { color: colors.textTertiary }]}>
          {formatRelativeTime(note.updated_at)}
        </Text>
      </View>
      {collapsible && !expanded ? (
        <Text numberOfLines={PREVIEW_LINES} style={[Type.body, { color: colors.text }]}>
          {text}
        </Text>
      ) : (
        <MessageMarkdown streaming={false} text={text} />
      )}
      {collapsible ? (
        <Pressable
          accessibilityLabel={
            expanded ? `Collapse the ${title} PXI note` : `Show the full ${title} PXI note`
          }
          accessibilityRole="button"
          onPress={() => setExpanded((current) => !current)}
          style={({ pressed }) => [styles.more, pressed && styles.pressed]}
        >
          <Text style={[Type.label, { color: colors.textSecondary }]}>
            {expanded ? 'Show less' : 'Show full note'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  note: { gap: 6, paddingHorizontal: RowInset, paddingVertical: 14 },
  noteHeader: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  noteTitle: { flex: 1 },
  more: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 48 },
  hint: { paddingBottom: 6, paddingHorizontal: RowInset, paddingTop: 4 },
  pressed: { opacity: 0.5 },
});

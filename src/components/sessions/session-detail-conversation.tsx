import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { type ReactElement, type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  type RefreshControlProps,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MessageMarkdown } from '@/components/chat/message-markdown';
import { isJsonBlockValue, JsonBlock } from '@/components/json-block';
import { MotionPressable } from '@/components/motion-pressable';
import { PxiGlyph } from '@/components/pxi-glyph';
import { EmptyState } from '@/components/ui/empty-state';
import { RowInset } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { StatusLabel, type StatusTone } from '@/components/ui/status-label';
import { AppFonts, Type, useAppColors } from '@/constants/theme';
import { useContentColumnStyle } from '@/features/duo/layout';
import type { PxiInvestigationStatus } from '@/features/pxi/investigation';
import type { PhoenixSpan, ReviewStatus, SessionTurn } from '@/features/session-review/types';
import type { usePhoenixSessionTurns } from '@/hooks/use-phoenix-sessions';
import { formatCompactNumber, formatDuration, formatRelativeTime } from '@/lib/format';
import { isJsonNumber, isJsonString } from '@/lib/json';

import type { LoadedSession } from './session-detail-types';

const MAX_TEXT_LENGTH = 50_000;
const PREVIEW_LENGTH = 1_500;
const TITLE_LENGTH = 140;

/** Content-side session actions, for platforms and hosts without a native bar. */
export type SessionContentActions = {
  investigationStatus: PxiInvestigationStatus | null;
  onAddToDataset: () => void;
  onCopySessionId: () => void;
  onInvestigate: () => void;
};

type TurnsQuery = ReturnType<typeof usePhoenixSessionTurns>;

/**
 * The conversation as one list: the session's title and meta line, then each
 * turn as a flat transcript entry, then `footer` (the review tools when the
 * view does not split them into their own column).
 */
export function ConversationList({
  actions,
  footer,
  instanceId,
  projectId,
  refreshControl,
  reviewStatus,
  session,
  turns,
}: {
  /** Null when the native bar holds the session's actions. */
  actions: SessionContentActions | null;
  footer?: ReactElement;
  instanceId: string;
  projectId: string;
  refreshControl: ReactElement<RefreshControlProps>;
  /** Undefined while the review state is still loading. */
  reviewStatus?: ReviewStatus;
  session: LoadedSession;
  turns: TurnsQuery;
}) {
  const insets = useSafeAreaInsets();
  const column = useContentColumnStyle(0);

  return (
    <FlatList
      contentContainerStyle={[styles.content, column, { paddingBottom: 30 + insets.bottom }]}
      contentInsetAdjustmentBehavior="automatic"
      data={turns.isSuccess ? turns.data : []}
      initialNumToRender={3}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(turn) => turn.traceId}
      ListHeaderComponent={
        <>
          <SessionHeader
            actions={actions}
            reviewStatus={reviewStatus}
            session={session}
            turns={turns.data}
          />
          <SectionHeader label="Conversation" />
          {turns.isPending ? (
            <EmptyState fill={false} loading title="Loading turns" />
          ) : turns.isError ? (
            <EmptyState
              action={{ label: 'Try again', onPress: () => void turns.refetch() }}
              fill={false}
              message={turns.error.message}
              symbol={{ android: 'warning', ios: 'exclamationmark.triangle', web: 'warning' }}
              title="Couldn’t load turns"
            />
          ) : !turns.data?.length ? (
            <EmptyState
              fill={false}
              message="This session has no traces to display."
              symbol={{ android: 'forum', ios: 'bubble.left.and.bubble.right', web: 'forum' }}
              title="No turns"
            />
          ) : null}
        </>
      }
      ListFooterComponent={footer}
      maxToRenderPerBatch={3}
      refreshControl={refreshControl}
      renderItem={({ index, item }) => (
        <TurnItem index={index} instanceId={instanceId} projectId={projectId} turn={item} />
      )}
      removeClippedSubviews={Platform.OS === 'android'}
      windowSize={5}
    />
  );
}

/** The session's title, its mono meta line, and its review state. */
export function SessionHeader({
  actions,
  reviewStatus,
  session,
  turns,
}: {
  actions: SessionContentActions | null;
  reviewStatus?: ReviewStatus;
  session: LoadedSession;
  turns?: SessionTurn[];
}) {
  const colors = useAppColors();
  const excerpt = firstMessageExcerpt(turns);
  const tokens = session.token_count_total ?? 0;

  const meta = [
    `${session.traces.length} turn${session.traces.length === 1 ? '' : 's'}`,
    formatDuration(elapsed(session.start_time, session.end_time)),
    tokens > 0 ? `${formatCompactNumber(tokens)} tok` : null,
    // The title already reads as the ID when no message excerpt is available.
    excerpt ? shortId(session.session_id) : null,
    relativeAgo(session.start_time),
  ].filter((part) => part !== null);

  const status = reviewStatus ? ReviewStatusLabels[reviewStatus] : null;

  return (
    <View>
      <View style={styles.header}>
        <Text
          numberOfLines={excerpt ? 2 : undefined}
          selectable
          style={[Type.title, { color: colors.text }]}
        >
          {excerpt ?? session.session_id}
        </Text>
        <Text selectable style={[Type.mono, { color: colors.textSecondary }]}>
          {meta.join(' · ')}
        </Text>
        {status ? <StatusLabel label={status.label} tone={status.tone} /> : null}
      </View>
      {actions ? <SessionActionsRow actions={actions} /> : null}
    </View>
  );
}

/** Investigate, Add to dataset, and Copy ID as quiet text buttons. */
function SessionActionsRow({ actions }: { actions: SessionContentActions }) {
  const colors = useAppColors();
  const investigating = actions.investigationStatus === 'running';

  const investigateLabel = investigating
    ? 'Investigating…'
    : actions.investigationStatus != null
      ? 'View investigation'
      : 'Investigate';

  return (
    <View style={styles.actions}>
      <TextAction
        accessibilityHint={
          actions.investigationStatus != null
            ? 'Opens the PXI investigation for this session'
            : 'Choose a model, then PXI open codes this session and saves notes for reviewers'
        }
        accessibilityLabel={
          investigating
            ? 'PXI is investigating'
            : actions.investigationStatus != null
              ? 'View PXI investigation'
              : 'Investigate with PXI'
        }
        icon={
          investigating ? (
            <ActivityIndicator color={colors.brand} size="small" />
          ) : (
            <PxiGlyph color={colors.brand} size={14} />
          )
        }
        label={investigateLabel}
        onPress={actions.onInvestigate}
      />
      <TextAction
        accessibilityHint="Saves this session’s turns as dataset examples"
        icon={
          <ActionSymbol
            name={{ android: 'move_to_inbox', ios: 'tray.and.arrow.down', web: 'move_to_inbox' }}
          />
        }
        label="Add to dataset"
        onPress={actions.onAddToDataset}
      />
      <TextAction
        accessibilityLabel="Copy session ID"
        icon={
          <ActionSymbol
            name={{ android: 'content_copy', ios: 'doc.on.doc', web: 'content_copy' }}
          />
        }
        label="Copy ID"
        onPress={actions.onCopySessionId}
      />
    </View>
  );
}

function ActionSymbol({ name }: { name: SymbolViewProps['name'] }) {
  const colors = useAppColors();

  return <SymbolView name={name} size={15} tintColor={colors.text} weight="medium" />;
}

function TextAction({
  accessibilityHint,
  accessibilityLabel,
  icon,
  label,
  onPress,
}: {
  accessibilityHint?: string;
  accessibilityLabel?: string;
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) {
  const colors = useAppColors();

  return (
    <MotionPressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      haptic="selection"
      onPress={onPress}
      style={styles.textAction}
    >
      {icon}
      <Text style={[styles.textActionLabel, { color: colors.text }]}>{label}</Text>
    </MotionPressable>
  );
}

/**
 * One turn of the transcript: the user's input as a quiet trailing bubble, the
 * output as plain text, and a mono footer that opens the turn's trace.
 */
function TurnItem({
  index,
  instanceId,
  projectId,
  turn,
}: {
  index: number;
  instanceId: string;
  projectId: string;
  turn: SessionTurn;
}) {
  const colors = useAppColors();
  const errored = turn.rootSpan?.status_code === 'ERROR';
  const tokens = turn.rootSpan ? totalTokens(turn.rootSpan) : 0;
  const number = index + 1;

  const footer = [
    `Turn ${number}`,
    formatDuration(elapsed(turn.startTime, turn.endTime)),
    tokens > 0 ? `${formatCompactNumber(tokens)} tok` : null,
  ].filter((part) => part !== null);

  return (
    <View style={styles.turn}>
      {!turn.rootSpan ? (
        <Text style={[Type.subhead, styles.missing, { color: colors.textSecondary }]}>
          Phoenix returned this trace without a root span, so its input and output are unknown.
        </Text>
      ) : (
        <>
          <ConversationValue
            empty="No input was recorded."
            io={turn.input}
            label={`Turn ${number} input`}
            role="user"
          />
          <ConversationValue
            empty="No output was recorded."
            io={turn.output}
            label={`Turn ${number} output`}
            role="assistant"
          />
        </>
      )}
      {errored && turn.rootSpan?.status_message ? (
        <Text numberOfLines={3} selectable style={[Type.subhead, { color: colors.danger }]}>
          {turn.rootSpan.status_message}
        </Text>
      ) : null}
      <View style={styles.turnFooter}>
        {errored ? <StatusLabel label="Error" tone="error" /> : null}
        <Text
          numberOfLines={1}
          style={[Type.mono, styles.turnMeta, { color: colors.textSecondary }]}
        >
          {footer.join(' · ')}
        </Text>
        <Pressable
          accessibilityHint="Opens this turn’s trace"
          accessibilityLabel={`Open trace for turn ${number}`}
          accessibilityRole="link"
          onPress={() =>
            router.push({
              pathname: '/instances/[id]/projects/[projectId]/traces/[traceId]',
              params: { id: instanceId, projectId, traceId: turn.traceId },
            })
          }
          style={({ pressed }) => [styles.traceLink, pressed && styles.pressed]}
        >
          <Text style={[Type.mono, { color: colors.text }]}>Trace</Text>
          <SymbolView
            name={{ android: 'arrow_outward', ios: 'arrow.up.right', web: 'arrow_outward' }}
            size={10}
            tintColor={colors.text}
            weight="semibold"
          />
        </Pressable>
      </View>
    </View>
  );
}

function ConversationValue({
  empty,
  io,
  label,
  role,
}: {
  empty: string;
  io?: SessionTurn['input'];
  /** Spoken before the content, since the bubble's alignment is visual only. */
  label: string;
  role: 'assistant' | 'user';
}) {
  const colors = useAppColors();
  const [expanded, setExpanded] = useState(false);
  const value = io?.value ?? '';
  const isLarge = value.length > PREVIEW_LENGTH;
  const visibleLimit = expanded ? MAX_TEXT_LENGTH : PREVIEW_LENGTH;
  const display = value.length > visibleLimit ? `${value.slice(0, visibleLimit)}…` : value;
  const user = role === 'user';

  const json = Boolean(
    display &&
    (!isLarge || expanded) &&
    (io?.mimeType?.toLowerCase().includes('json') || isJsonBlockValue(display)),
  );

  const body = !display ? (
    <Text
      style={[
        Type.subhead,
        styles.missing,
        user && styles.trailing,
        { color: colors.textTertiary },
      ]}
    >
      {empty}
    </Text>
  ) : json ? (
    <JsonBlock maxHeight={320} value={display} />
  ) : !user ? (
    // Agents answer in Markdown; render it the way the PXI chat does.
    <View accessibilityLabel={label}>
      <MessageMarkdown streaming={false} text={display} />
    </View>
  ) : (
    <Text
      accessibilityLabel={`${label}: ${display}`}
      selectable
      style={[Type.body, user ? styles.userText : styles.assistantText, { color: colors.text }]}
    >
      {display}
    </Text>
  );

  return (
    <View style={user ? styles.userValue : styles.assistantValue}>
      {/* JSON keeps its code surface at full width instead of sitting in a bubble. */}
      {user && display && !json ? (
        <View style={[styles.bubble, { backgroundColor: colors.bubble }]}>{body}</View>
      ) : (
        body
      )}
      {isLarge ? (
        <Pressable
          accessibilityLabel={expanded ? `Collapse ${label}` : `Show all of ${label}`}
          accessibilityRole="button"
          onPress={() => setExpanded((current) => !current)}
          style={({ pressed }) => [
            styles.expand,
            user && styles.trailing,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[Type.label, { color: colors.textSecondary }]}>
            {expanded ? 'Show less' : 'Show more'}
          </Text>
        </Pressable>
      ) : null}
      {expanded && value.length > MAX_TEXT_LENGTH ? (
        <Text style={[Type.mono, user && styles.trailing, { color: colors.textTertiary }]}>
          First {formatCompactNumber(MAX_TEXT_LENGTH)} characters shown
        </Text>
      ) : null}
    </View>
  );
}

const ReviewStatusLabels = {
  complete: { label: 'Reviewed', tone: 'ok' },
  partial: { label: 'Partly reviewed', tone: 'pending' },
  stale: { label: 'Needs attention', tone: 'error' },
  'not-configured': null,
  unreviewed: { label: 'Needs review', tone: 'neutral' },
} satisfies Record<ReviewStatus, { label: string; tone: StatusTone } | null>;

/** The first turn's input as a title, when it is prose rather than a payload. */
function firstMessageExcerpt(turns: SessionTurn[] | undefined): string | null {
  const value = turns?.[0]?.input?.value.trim();

  if (!value || isJsonBlockValue(value)) return null;
  const collapsed = value.replace(/\s+/g, ' ');

  return collapsed.length > TITLE_LENGTH ? `${collapsed.slice(0, TITLE_LENGTH)}…` : collapsed;
}

/** The tail of an ID: session IDs often share a prefix and differ at the end. */
function shortId(id: string) {
  return id.length > 10 ? `…${id.slice(-8)}` : id;
}

function relativeAgo(value: string) {
  const relative = formatRelativeTime(value);

  return /^\d+[mhd]$/.test(relative) ? `${relative} ago` : relative;
}

function elapsed(start: string, end: string) {
  return Math.max(0, new Date(end).getTime() - new Date(start).getTime());
}

function numericAttribute(span: PhoenixSpan, key: string) {
  const value = span.attributes?.[key];

  if (isJsonNumber(value)) return value;

  if (isJsonString(value)) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) return parsed;
  }

  return 0;
}

/** A root span carries token counts only when it is the LLM call itself. */
function totalTokens(span: PhoenixSpan) {
  return (
    numericAttribute(span, 'llm.token_count.total') ||
    numericAttribute(span, 'llm.token_count.prompt') +
      numericAttribute(span, 'llm.token_count.completion')
  );
}

const styles = StyleSheet.create({
  content: { alignSelf: 'center', width: '100%' },
  header: { gap: 6, paddingHorizontal: RowInset, paddingTop: 12 },
  actions: {
    columnGap: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
    paddingHorizontal: RowInset,
  },
  textAction: { alignItems: 'center', flexDirection: 'row', gap: 7, minHeight: 48 },
  textActionLabel: { fontFamily: AppFonts.medium, fontSize: 14 },
  turn: { gap: 12, paddingHorizontal: RowInset, paddingTop: 20 },
  userValue: { alignItems: 'flex-end', gap: 2 },
  assistantValue: { alignItems: 'stretch', gap: 2 },
  bubble: { borderRadius: 18, maxWidth: '86%', paddingHorizontal: 14, paddingVertical: 9 },
  userText: { flexShrink: 1 },
  assistantText: { lineHeight: 23 },
  missing: { fontStyle: 'italic' },
  trailing: { alignSelf: 'flex-end' },
  expand: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 48 },
  turnFooter: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 48 },
  turnMeta: { flex: 1 },
  traceLink: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 48,
    paddingLeft: 12,
  },
  pressed: { opacity: 0.5 },
});

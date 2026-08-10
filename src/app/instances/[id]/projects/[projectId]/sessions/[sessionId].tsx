import { ScoreSlider } from '@/components/score-slider';
import * as Clipboard from 'expo-clipboard';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatBottomSheet } from '@/components/chat/chat-bottom-sheet';
import { MessageMarkdown } from '@/components/chat/message-markdown';
import { ModelPicker } from '@/components/chat/model-picker';
import { isJsonValue, JsonBlock } from '@/components/json-block';
import { MotionPressable } from '@/components/motion-pressable';
import { PxiGlyph } from '@/components/pxi-glyph';
import { AppFonts, MaxContentWidth, useAppColors } from '@/constants/theme';
import {
  createPxiInvestigationKey,
  usePxiInvestigationStore,
  type PxiInvestigationStatus,
} from '@/features/pxi/investigation';
import { isSameModel, usePxiModelCatalog } from '@/features/pxi/model-catalog';
import type { ModelSelection } from '@/features/pxi/types';
import { classifySessionReview, latestOwnedAnnotation } from '@/features/session-review/classifier';
import {
  createAuthenticatedAnnotationIdentifier,
  createSessionReviewIdentifier,
} from '@/features/session-review/api';
import type {
  SessionAnnotation,
  SessionAnnotationConfig,
  SessionAnnotationDraft,
  SessionTurn,
  SpanNoteAnnotation,
} from '@/features/session-review/types';
import { usePhoenixProjects, usePhoenixViewer } from '@/hooks/use-phoenix-data';
import {
  usePhoenixProjectAnnotationConfigs,
  usePhoenixSession,
  usePhoenixSessionAnnotations,
  usePhoenixSessionPxiNotes,
  usePhoenixSessionTurns,
  useWritePhoenixSessionAnnotations,
  useWritePhoenixSessionNote,
} from '@/hooks/use-phoenix-sessions';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';
import {
  getSessionReviewQueueSettings,
  useSessionReviewSettingsStore,
} from '@/store/session-review-settings';

type ReviewValue = {
  explanation: string;
  value: string;
};

const MAX_TEXT_LENGTH = 50_000;

export default function SessionDetailScreen() {
  const { id, projectId, queueFilter, sessionId } = useLocalSearchParams<{
    id: string;
    projectId: string;
    queueFilter?: 'all' | 'needs-review' | 'reviewed';
    sessionId: string;
  }>();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const instance = useInstanceStore((state) => state.instances.find((item) => item.id === id));
  const projects = usePhoenixProjects(instance);
  const project = projects.data?.find((candidate) => candidate.id === projectId);
  const session = usePhoenixSession(instance, projectId, sessionId);
  const turns = usePhoenixSessionTurns(instance, projectId, session.data);
  const configsQuery = usePhoenixProjectAnnotationConfigs(instance, projectId);
  const viewer = usePhoenixViewer(instance);
  const queues = useSessionReviewSettingsStore((state) => state.queues);
  const reviewSettingsHydrated = useSessionReviewSettingsStore((state) => state.hasHydrated);
  const anonymousReviewerId = useSessionReviewSettingsStore(
    (state) => state.anonymousReviewerIds[id]
  );
  const ensureAnonymousReviewerId = useSessionReviewSettingsStore(
    (state) => state.ensureAnonymousReviewerId
  );
  const settings = getSessionReviewQueueSettings(queues, id, projectId);
  const configs = settings.requiredConfigNames.flatMap((name) => {
    const config = configsQuery.data?.find((candidate) => candidate.name === name);
    return config ? [config] : [];
  });
  const staleNames = settings.requiredConfigNames.filter(
    (name) => !configsQuery.data?.some((config) => config.name === name)
  );
  const annotations = usePhoenixSessionAnnotations(
    instance,
    projectId,
    session.data ? [[session.data.session_id]] : [],
    // Include the reserved note annotation so the form can tell whether this
    // installation already saved a note; the classifier ignores notes.
    settings.requiredConfigNames.length > 0 ? [...settings.requiredConfigNames, 'note'] : []
  );
  const pxiNotes = usePhoenixSessionPxiNotes(instance, projectId, session.data?.session_id, turns.data);
  const catalog = usePxiModelCatalog(instance);
  const preferredPxiModel = useInstanceStore((state) => state.pxiModels[id]);
  const setPxiModel = useInstanceStore((state) => state.setPxiModel);
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const investigationKey = session.data
    ? createPxiInvestigationKey('investigate-session', id, projectId, session.data.session_id)
    : null;
  const investigation = usePxiInvestigationStore(
    (state) => (investigationKey ? state.runs[investigationKey] : undefined)
  );
  const isRefreshing = session.isRefetching
    || turns.isRefetching
    || configsQuery.isRefetching
    || annotations.isRefetching
    || pxiNotes.isRefetching
    || viewer.isRefetching;

  useEffect(() => {
    if (reviewSettingsHydrated && !anonymousReviewerId) ensureAnonymousReviewerId(id);
  }, [anonymousReviewerId, ensureAnonymousReviewerId, id, reviewSettingsHydrated]);

  if (!instance) return <UnavailableState title="Instance not found" message="This Phoenix connection is no longer on this device." />;
  if (projects.isSuccess && !project) return <UnavailableState title="Project not found" message="This project is no longer available." />;

  const openInvestigationSheet = (model?: ModelSelection) => {
    if (!session.data) return;
    router.push({
      pathname: '/instances/[id]/pxi-action',
      params: {
        action: 'investigate-session',
        id,
        projectId,
        sessionId: session.data.session_id,
        sessionNodeId: session.data.id,
        ...(model
          ? {
              modelName: model.modelName,
              modelProviderType: model.providerType,
              ...(model.providerType === 'builtin'
                ? { modelProvider: model.provider }
                : { modelProviderId: model.providerId }),
            }
          : {}),
      },
    });
  };
  const investigate = () => {
    // An existing run (live or finished while the sheet was closed) reopens the
    // transcript; the model choice only applies to a brand-new investigation.
    if (investigation) {
      openInvestigationSheet();
      return;
    }
    if (!catalog.data || catalog.data.options.length === 0) {
      openInvestigationSheet();
      return;
    }
    setModelPickerVisible(true);
  };

  const refresh = async () => {
    haptics.selection();
    const sessionResult = await session.refetch();
    const results = await Promise.all([
      configsQuery.refetch(),
      annotations.refetch(),
      viewer.refetch(),
      ...(sessionResult.isError ? [] : [turns.refetch(), pxiNotes.refetch()]),
    ]);
    if (sessionResult.isError || results.some((result) => result.isError)) haptics.error();
    else haptics.light();
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerBackTitle: 'Sessions', title: 'Session' }} />
      {session.isPending ? (
        <CenterState loading copy="Loading session..." />
      ) : session.isError ? (
        <CenterState title="Couldn’t load this session" copy={session.error.message} action="Try again" onPress={() => session.refetch()} />
      ) : !session.data ? (
        <CenterState title="Session not found" copy="Phoenix returned no session data." />
      ) : (
        <FlatList
          contentContainerStyle={[styles.content, { paddingBottom: 30 + insets.bottom }]}
          contentInsetAdjustmentBehavior="automatic"
          data={turns.isSuccess ? turns.data : []}
          initialNumToRender={3}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          keyExtractor={(turn) => turn.traceId}
          ListHeaderComponent={
            <>
              <SessionHeader
                instanceId={id}
                investigationStatus={investigation?.status ?? null}
                onInvestigate={investigate}
                projectId={projectId}
                session={session.data}
              />
              <SessionMetrics session={session.data} />
              {/* Turn cards are list items outside this container, so the heading
                  carries the section's 13pt heading-to-content gap itself. */}
              <View style={[styles.section, (turns.data?.length ?? 0) > 0 && styles.conversationLead]}>
              <View style={styles.sectionHeading}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Conversation</Text>
                <Text style={[styles.sectionMeta, { color: colors.textSecondary }]}>{session.data.traces.length} turn{session.data.traces.length === 1 ? '' : 's'}</Text>
              </View>
              {turns.isPending ? (
                <ActivityIndicator color={colors.accent} style={styles.sectionLoader} />
              ) : turns.isError ? (
                <InlineState title="Couldn’t load turns" copy={turns.error.message} action="Retry" onPress={() => turns.refetch()} />
              ) : !turns.data?.length ? (
                <InlineState title="No turns found" copy="This session has no traces to display." />
              ) : null}
              </View>
            </>
          }
          ListFooterComponent={
            <>
            <PxiNotesSection notes={pxiNotes} turns={turns.data ?? []} />
            <ReviewForm
              allAnnotations={annotations.data ?? []}
              annotationsError={annotations.error}
              annotationsSuccess={settings.requiredConfigNames.length === 0 || annotations.isSuccess}
              anonymousReviewerId={anonymousReviewerId}
              configs={configs}
              configsError={configsQuery.error}
              configsSuccess={configsQuery.isSuccess}
              projectId={projectId}
              queueFilter={queueFilter}
              retry={refresh}
              routeInstanceId={id}
              key={session.data.session_id}
              sessionId={session.data.session_id}
              staleNames={staleNames}
              viewer={viewer.data}
              viewerError={viewer.error}
              viewerSuccess={viewer.isSuccess}
            />
            </>
          }
          maxToRenderPerBatch={3}
          refreshControl={
            <RefreshControl
              colors={[colors.brand]}
              onRefresh={() => void refresh()}
              progressBackgroundColor={colors.backgroundElement}
              refreshing={isRefreshing}
              tintColor={colors.brand}
            />
          }
          renderItem={({ index, item }) => (
            <TurnCard id={id} index={index} projectId={projectId} turn={item} />
          )}
          ItemSeparatorComponent={() => <View style={styles.turnSeparator} />}
          removeClippedSubviews={Platform.OS === 'android'}
          windowSize={5}
        />
      )}
      {catalog.data && catalog.data.options.length > 0 ? (
        <ModelPicker
          onClose={() => setModelPickerVisible(false)}
          onSelect={(model) => {
            setPxiModel(id, model);
            setModelPickerVisible(false);
            openInvestigationSheet(model);
          }}
          options={catalog.data.options}
          selected={
            catalog.data.options.find(
              (option) => preferredPxiModel && isSameModel(option.selection, preferredPxiModel)
            )?.selection
              ?? catalog.data.defaultSelection
              ?? catalog.data.options[0].selection
          }
          visible={modelPickerVisible}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

function SessionHeader({ instanceId, investigationStatus, onInvestigate, projectId, session }: {
  instanceId: string;
  investigationStatus: PxiInvestigationStatus | null;
  onInvestigate: () => void;
  projectId: string;
  session: NonNullable<ReturnType<typeof usePhoenixSession>['data']>;
}) {
  const colors = useAppColors();
  const investigating = investigationStatus === 'running';
  const investigateLabel = investigating
    ? 'PXI is investigating…'
    : investigationStatus != null
      ? 'View PXI investigation'
      : 'Investigate with PXI';
  return (
    <View style={styles.hero}>
      <Text style={[styles.eyebrow, { color: colors.brandText }]}>REMOTE PHOENIX SESSION</Text>
      <Text selectable style={[styles.sessionId, { color: colors.text }]}>{session.session_id}</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Started {formatDate(session.start_time)}</Text>
      <View style={styles.heroActions}>
        <MotionPressable
          accessibilityLabel="Copy session ID"
          accessibilityRole="button"
          haptic="selection"
          onPress={() => void Clipboard.setStringAsync(session.session_id).then(haptics.success)}
          style={[styles.copyButton, { borderColor: colors.border }]}>
          <Text style={[styles.copyLabel, { color: colors.text }]}>Copy session ID</Text>
        </MotionPressable>
        <MotionPressable
          accessibilityHint="Saves this session’s turns as dataset examples"
          accessibilityLabel="Add to dataset"
          accessibilityRole="button"
          haptic="selection"
          onPress={() => router.push({
            pathname: '/instances/[id]/projects/[projectId]/sessions/add-to-dataset',
            params: { id: instanceId, projectId, sessionId: session.session_id },
          })}
          style={[styles.copyButton, { borderColor: colors.border }]}>
          <Text style={[styles.copyLabel, { color: colors.text }]}>Add to dataset</Text>
        </MotionPressable>
        <MotionPressable
          accessibilityHint={investigationStatus != null
            ? 'Opens the running PXI investigation for this session'
            : 'Choose a model, then PXI open codes this session and saves notes for reviewers'}
          accessibilityLabel={investigateLabel}
          accessibilityRole="button"
          haptic="selection"
          onPress={onInvestigate}
          style={[styles.copyButton, styles.pxiButton, { borderColor: colors.border }]}>
          {investigating ? (
            <ActivityIndicator color={colors.brand} size="small" />
          ) : (
            <PxiGlyph color={colors.brand} size={13} />
          )}
          <Text style={[styles.copyLabel, { color: colors.text }]}>{investigateLabel}</Text>
        </MotionPressable>
      </View>
    </View>
  );
}

function SessionMetrics({ session }: { session: NonNullable<ReturnType<typeof usePhoenixSession>['data']> }) {
  const duration = Math.max(0, new Date(session.end_time).getTime() - new Date(session.start_time).getTime());
  return (
    <View style={styles.metrics}>
      <Metric label="Duration" value={formatDuration(duration)} />
      <Metric label="Traces" value={String(session.traces.length)} />
      <Metric label="Prompt" value={formatCount(session.token_count_prompt ?? 0)} />
      <Metric label="Completion" value={formatCount(session.token_count_completion ?? 0)} />
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const colors = useAppColors();
  return (
    <View style={[styles.metric, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
      <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

function TurnCard({ id, index, projectId, turn }: { id: string; index: number; projectId: string; turn: SessionTurn }) {
  const colors = useAppColors();
  const errored = turn.rootSpan?.status_code === 'ERROR';
  return (
    <View style={[styles.turn, { borderColor: errored ? colors.danger : colors.border }]}>
      <View style={styles.turnHeader}>
        <View>
          <View style={styles.turnTitleRow}>
            <Text style={[styles.turnTitle, { color: colors.text }]}>Turn {index + 1}</Text>
            {errored ? (
              <View accessibilityLabel={`Turn ${index + 1} ended in an error`} style={[styles.errorChip, { backgroundColor: colors.danger }]}>
                <Text style={styles.errorChipLabel}>Error</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.turnTime, { color: colors.textSecondary }]}>{formatDate(turn.startTime)} · {formatDuration(Math.max(0, new Date(turn.endTime).getTime() - new Date(turn.startTime).getTime()))}</Text>
          {errored && turn.rootSpan?.status_message ? (
            <Text numberOfLines={2} style={[styles.turnErrorMessage, { color: colors.danger }]}>{turn.rootSpan.status_message}</Text>
          ) : null}
        </View>
        <MotionPressable
          accessibilityLabel={`Open trace for turn ${index + 1}`}
          accessibilityRole="button"
          onPress={() => router.push({
            pathname: '/instances/[id]/projects/[projectId]/traces/[traceId]',
            params: { id, projectId, traceId: turn.traceId },
          })}
          style={[styles.traceButton, { backgroundColor: colors.backgroundSelected }]}>
          <Text style={[styles.traceLabel, { color: colors.text }]}>Trace</Text>
        </MotionPressable>
      </View>
      {!turn.rootSpan ? (
        <InlineState title="Root span unavailable" copy="Phoenix returned the trace, but no root span was found for this turn." />
      ) : (
        <>
          <ConversationValue label="Input" io={turn.input} empty="No root-span input was recorded." tone="user" />
          <ConversationValue label="Output" io={turn.output} empty="No root-span output was recorded." tone="assistant" />
        </>
      )}
    </View>
  );
}

function ConversationValue({ empty, io, label, tone }: { empty: string; io?: SessionTurn['input']; label: string; tone: 'assistant' | 'user' }) {
  const colors = useAppColors();
  const [expanded, setExpanded] = useState(false);
  const value = io?.value ?? '';
  const isLarge = value.length > 1_500;
  const visibleLimit = expanded ? MAX_TEXT_LENGTH : 1_500;
  const display = value.length > visibleLimit ? `${value.slice(0, visibleLimit)}\n...` : value;
  const json = Boolean(display && (!isLarge || expanded) && (
    io?.mimeType?.toLowerCase().includes('json') || isJsonValue(display)
  ));
  return (
    <View style={[styles.message, { backgroundColor: tone === 'user' ? colors.backgroundSelected : colors.backgroundElement }]}>
      <Text style={[styles.messageLabel, { color: tone === 'user' ? colors.brandText : colors.brandSecondaryText }]}>{label}</Text>
      {!display ? (
        <Text style={[styles.missingIo, { color: colors.textSecondary }]}>{empty}</Text>
      ) : json ? (
        <JsonBlock maxHeight={320} value={display} />
      ) : (
        <Text selectable style={[styles.messageText, { color: colors.text }]}>{display}</Text>
      )}
      {isLarge ? (
        <MotionPressable
          accessibilityRole="button"
          onPress={() => setExpanded((current) => !current)}
          style={[styles.expandButton, { borderColor: colors.border }]}>
          <Text style={[styles.expandLabel, { color: colors.text }]}>{expanded ? 'Show preview' : 'Expand content'}</Text>
        </MotionPressable>
      ) : null}
      {expanded && value.length > MAX_TEXT_LENGTH ? (
        <Text style={[styles.truncated, { color: colors.textSecondary }]}>Showing the first {formatCount(MAX_TEXT_LENGTH)} characters.</Text>
      ) : null}
    </View>
  );
}

function PxiNotesSection({ notes, turns }: {
  notes: ReturnType<typeof usePhoenixSessionPxiNotes>;
  turns: SessionTurn[];
}) {
  const colors = useAppColors();
  const turnIndexBySpanId = new Map<string, number>();
  turns.forEach((turn, index) => {
    if (turn.rootSpan) turnIndexBySpanId.set(turn.rootSpan.context.span_id, index);
  });
  const data = [...(notes.data ?? [])].sort((left, right) =>
    (turnIndexBySpanId.get(left.span_id) ?? Number.MAX_SAFE_INTEGER)
    - (turnIndexBySpanId.get(right.span_id) ?? Number.MAX_SAFE_INTEGER)
  );
  if (!notes.isError && data.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>PXI notes</Text>
        {data.length > 0 ? (
          <Text style={[styles.sectionMeta, { color: colors.textSecondary }]}>
            {data.length} note{data.length === 1 ? '' : 's'}
          </Text>
        ) : null}
      </View>
      {notes.isError ? (
        <InlineState
          action="Retry"
          copy={notes.error.message}
          onPress={() => notes.refetch()}
          title="Couldn’t load PXI notes"
        />
      ) : (
        <>
          {data.map((note) => {
            const turnIndex = turnIndexBySpanId.get(note.span_id);
            return (
              <PxiNoteCard
                key={note.id}
                note={note}
                title={turnIndex != null ? `Turn ${turnIndex + 1}` : 'Session'}
              />
            );
          })}
          <Text style={[styles.pxiNoteHint, { color: colors.textSecondary }]}>
            PXI wrote these open-coding notes on this session’s turns. Weigh them against the conversation before annotating; they never mark a session reviewed.
          </Text>
        </>
      )}
    </View>
  );
}

// Notes lead with a one-sentence code summary (part of the investigate-session
// prompt contract), so the collapsed preview reads as a labeled finding.
const PXI_NOTE_PREVIEW_LINES = 4;
const PXI_NOTE_PREVIEW_THRESHOLD = 320;

function PxiNoteCard({ note, title }: { note: SpanNoteAnnotation; title: string }) {
  const colors = useAppColors();
  const [expanded, setExpanded] = useState(false);
  const text = note.result?.explanation ?? '';
  const collapsible = text.length > PXI_NOTE_PREVIEW_THRESHOLD;
  return (
    <View style={[styles.pxiNote, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
      <View style={styles.pxiNoteHeader}>
        <PxiGlyph color={colors.brand} size={13} />
        <Text style={[styles.pxiNoteTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.pxiNoteTime, { color: colors.textSecondary }]}>{formatDate(note.updated_at)}</Text>
      </View>
      {collapsible && !expanded ? (
        <Text numberOfLines={PXI_NOTE_PREVIEW_LINES} style={[styles.pxiNotePreview, { color: colors.text }]}>
          {text}
        </Text>
      ) : (
        <MessageMarkdown streaming={false} text={text} />
      )}
      {collapsible ? (
        <MotionPressable
          accessibilityLabel={expanded ? `Collapse the ${title} PXI note` : `Show the full ${title} PXI note`}
          accessibilityRole="button"
          onPress={() => setExpanded((current) => !current)}
          style={[styles.expandButton, { borderColor: colors.border }]}>
          <Text style={[styles.expandLabel, { color: colors.text }]}>{expanded ? 'Show less' : 'Show full note'}</Text>
        </MotionPressable>
      ) : null}
    </View>
  );
}

function ReviewForm({
  allAnnotations,
  annotationsError,
  annotationsSuccess,
  anonymousReviewerId,
  configs,
  configsError,
  configsSuccess,
  projectId,
  queueFilter,
  retry,
  routeInstanceId,
  sessionId,
  staleNames,
  viewer,
  viewerError,
  viewerSuccess,
}: {
  allAnnotations: SessionAnnotation[];
  annotationsError: Error | null;
  annotationsSuccess: boolean;
  anonymousReviewerId?: string;
  configs: SessionAnnotationConfig[];
  configsError: Error | null;
  configsSuccess: boolean;
  projectId: string;
  queueFilter?: 'all' | 'needs-review' | 'reviewed';
  retry: () => Promise<void>;
  routeInstanceId: string;
  sessionId: string;
  staleNames: string[];
  viewer: ReturnType<typeof usePhoenixViewer>['data'];
  viewerError: Error | null;
  viewerSuccess: boolean;
}) {
  const colors = useAppColors();
  const instance = useInstanceStore((state) => state.instances.find((item) => item.id === routeInstanceId));
  const writeAnnotations = useWritePhoenixSessionAnnotations(instance, projectId);
  const writeNote = useWritePhoenixSessionNote(instance, projectId);
  const [values, setValues] = useState<Record<string, ReviewValue>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pristine, setPristine] = useState(true);
  const initializedSource = useRef('');
  const authenticatedViewerId = viewer && viewer.auth_method !== 'ANONYMOUS' ? viewer.id : null;
  const annotationIdentifier = viewer?.auth_method === 'ANONYMOUS'
    ? anonymousReviewerId
      ? createSessionReviewIdentifier('annotation', anonymousReviewerId)
      : null
    : authenticatedViewerId
      ? createAuthenticatedAnnotationIdentifier(authenticatedViewerId)
      : null;
  const noteOwner = viewer?.auth_method === 'ANONYMOUS' ? anonymousReviewerId : authenticatedViewerId;
  const noteIdentifier = noteOwner ? createSessionReviewIdentifier('note', noteOwner) : null;
  const readOnly = viewer?.auth_method !== 'ANONYMOUS' && viewer?.role === 'VIEWER';
  const canSubmit = Boolean(
    annotationIdentifier
    && noteIdentifier
    && !readOnly
    && configs.length > 0
    && staleNames.length === 0
    && configsSuccess
    && annotationsSuccess
    && viewerSuccess
  );
  const classification = classifySessionReview(
    configs.map((config) => config.name),
    configs,
    allAnnotations
  );
  const existingNote = noteIdentifier
    ? latestOwnedAnnotation(allAnnotations, 'note', noteIdentifier, authenticatedViewerId)
    : undefined;

  useEffect(() => {
    if (!annotationsSuccess || !configsSuccess || !viewerSuccess || !pristine || !annotationIdentifier) return;
    const source = JSON.stringify([
      sessionId,
      annotationIdentifier,
      configs.map((config) => [config.id, config.name, config.type]),
      allAnnotations.map((annotation) => [annotation.id, annotation.updated_at]),
    ]);
    if (initializedSource.current === source) return;
    const nextValues: Record<string, ReviewValue> = {};
    for (const config of configs) {
      const current = latestOwnedAnnotation(
        allAnnotations,
        config.name,
        annotationIdentifier,
        authenticatedViewerId
      );
      nextValues[config.name] = {
        explanation: config.type === 'FREEFORM' ? '' : current?.result?.explanation ?? '',
        value: config.type === 'CATEGORICAL'
          ? current?.result?.label ?? ''
          : config.type === 'CONTINUOUS' && current?.result?.score != null
            ? String(current.result.score)
            : config.type === 'FREEFORM'
              ? current?.result?.explanation ?? ''
              : '',
      };
    }
    setValues(nextValues);
    initializedSource.current = source;
  }, [
    allAnnotations,
    annotationIdentifier,
    annotationsSuccess,
    authenticatedViewerId,
    configs,
    configsSuccess,
    pristine,
    sessionId,
    viewerSuccess,
  ]);

  const update = (name: string, field: keyof ReviewValue, value: string) => {
    setPristine(false);
    setValues((current) => ({
      ...current,
      [name]: { ...(current[name] ?? { explanation: '', value: '' }), [field]: value },
    }));
  };
  const submit = async (moveNext: boolean) => {
    if (!annotationIdentifier || !noteIdentifier || !canSubmit) return;
    setError(null);
    let drafts: { config: SessionAnnotationConfig; draft: SessionAnnotationDraft }[];
    try {
      drafts = configs.map((config) => ({ config, draft: draftForConfig(config, values[config.name]) }));
    } catch (submissionError) {
      setError(formatError(submissionError));
      haptics.error();
      return;
    }

    try {
      await writeAnnotations.mutateAsync({
        annotations: drafts.map(({ config, draft }) => ({
          config,
          draft,
          identifier: annotationIdentifier,
          sessionId,
        })),
      });
      if (note.trim()) {
        await writeNote.mutateAsync({ identifier: noteIdentifier, note, sessionId });
      }
      haptics.success();
      if (moveNext) {
        if (router.canGoBack()) router.back();
        else {
          router.replace({
            pathname: '/instances/[id]/projects/[projectId]/sessions',
            params: {
              filter: queueFilter ?? 'needs-review',
              id: routeInstanceId,
              projectId,
            },
          });
        }
      } else {
        setNote('');
        initializedSource.current = '';
        setPristine(true);
      }
    } catch (submissionError) {
      setError(`${formatError(submissionError)} Your entries are still here; retrying updates the same current-viewer values.`);
      haptics.error();
    }
  };
  const submitting = writeAnnotations.isPending || writeNote.isPending;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Human review</Text>
        {configs.length > 0 ? (
          <Text style={[styles.sectionMeta, { color: classification.status === 'complete' ? colors.success : colors.textSecondary }]}>
            {classification.completedConfigNames.length}/{configs.length} complete
          </Text>
        ) : null}
      </View>

      {configsError || annotationsError || viewerError ? (
        <InlineState
          action="Try again"
          copy={(configsError ?? annotationsError ?? viewerError)!.message}
          onPress={() => void retry()}
          title="Couldn’t prepare this review"
        />
      ) : !configsSuccess || !annotationsSuccess || !viewerSuccess ? (
        <ActivityIndicator color={colors.accent} style={styles.sectionLoader} />
      ) : configs.length === 0 || staleNames.length > 0 ? (
        <InlineState
          action="Edit queue"
          copy={staleNames.length > 0
            ? `${staleNames.join(', ')} no longer exist. Update the queue before reviewing.`
            : 'Choose one or more project annotation configurations to define completion.'}
          onPress={() => router.push({
            pathname: '/instances/[id]/projects/[projectId]/sessions/settings',
            params: { id: routeInstanceId, projectId },
          })}
          title={staleNames.length > 0 ? 'Queue configuration is stale' : 'Queue not configured'}
        />
      ) : (
        <View style={styles.reviewFields}>
          {readOnly ? (
            <View style={[styles.readOnly, { backgroundColor: colors.backgroundSelected, borderColor: colors.border }]}>
              <Text style={[styles.readOnlyTitle, { color: colors.text }]}>Read-only access</Text>
              <Text style={[styles.fieldDescription, { color: colors.textSecondary }]}>Your Phoenix Viewer role can browse this queue but cannot submit annotations or notes.</Text>
            </View>
          ) : !annotationIdentifier || !noteIdentifier ? (
            <View style={[styles.readOnly, { backgroundColor: colors.backgroundSelected, borderColor: colors.border }]}>
              <Text style={[styles.readOnlyTitle, { color: colors.text }]}>Viewer identity unavailable</Text>
              <Text style={[styles.fieldDescription, { color: colors.textSecondary }]}>Refresh after authentication is restored before submitting a review.</Text>
            </View>
          ) : null}

          {classification.invalidConfigNames.length > 0 ? (
            <View style={[styles.readOnly, { backgroundColor: colors.backgroundSelected, borderColor: colors.danger }]}>
              <Text style={[styles.readOnlyTitle, { color: colors.text }]}>Why this session needs attention</Text>
              <Text style={[styles.fieldDescription, { color: colors.textSecondary }]}>
                {classification.invalidConfigNames.join(', ')} {classification.invalidConfigNames.length === 1 ? 'has an annotation that doesn’t' : 'have annotations that don’t'} match the current configuration, such as an out-of-range score or a removed label. Submitting a valid value below completes that part of the review.
              </Text>
            </View>
          ) : null}

          {configs.map((config) => (
            <ReviewControl
              config={config}
              disabled={!canSubmit || submitting}
              key={config.id}
              onChange={(field, value) => update(config.name, field, value)}
              value={values[config.name] ?? { explanation: '', value: '' }}
            />
          ))}

          <View style={[styles.reviewField, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>Session note</Text>
            <Text style={[styles.fieldDescription, { color: colors.textSecondary }]}>
              {existingNote
                ? 'You already saved a note for this session. Submitting new text replaces it; leaving this empty keeps it. Notes never mark a session reviewed.'
                : 'Optional context for other reviewers. Notes never mark a session reviewed.'}
            </Text>
            {existingNote?.result?.explanation ? (
              <Text numberOfLines={4} style={[styles.existingNote, { borderColor: colors.border, color: colors.textSecondary }]}>{existingNote.result.explanation}</Text>
            ) : null}
            <TextInput
              accessibilityLabel="Optional session note"
              editable={canSubmit && !submitting}
              multiline
              onChangeText={(value) => {
                setPristine(false);
                setNote(value);
              }}
              placeholder="Add context for other reviewers"
              placeholderTextColor={colors.textSecondary}
              style={[styles.textArea, { borderColor: colors.border, color: colors.text }]}
              textAlignVertical="top"
              value={note}
            />
          </View>

          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
          <View style={styles.submitActions}>
            <MotionPressable
              accessibilityRole="button"
              disabled={!canSubmit || submitting}
              onPress={() => void submit(false)}
              style={[styles.secondarySubmit, { borderColor: colors.border, opacity: canSubmit && !submitting ? 1 : 0.45 }]}>
              <Text style={[styles.secondarySubmitLabel, { color: colors.text }]}>{submitting ? 'Saving...' : 'Submit'}</Text>
            </MotionPressable>
            <MotionPressable
              accessibilityRole="button"
              disabled={!canSubmit || submitting}
              onPress={() => void submit(true)}
              style={[styles.primarySubmit, { backgroundColor: colors.accent, opacity: canSubmit && !submitting ? 1 : 0.45 }]}>
              <Text style={[styles.primarySubmitLabel, { color: colors.accentForeground }]}>Submit & back to queue</Text>
            </MotionPressable>
          </View>
        </View>
      )}
    </View>
  );
}

function ReviewControl({ config, disabled, onChange, value }: {
  config: SessionAnnotationConfig;
  disabled: boolean;
  onChange: (field: keyof ReviewValue, value: string) => void;
  value: ReviewValue;
}) {
  const colors = useAppColors();
  const [explainVisible, setExplainVisible] = useState(false);
  const finiteRange = config.type === 'CONTINUOUS'
    && config.lower_bound != null
    && config.upper_bound != null
    && Number.isFinite(config.lower_bound)
    && Number.isFinite(config.upper_bound)
    && config.upper_bound > config.lower_bound;
  const numericValue = Number(value.value);
  const sliderValue = config.type === 'CONTINUOUS' && finiteRange && Number.isFinite(numericValue)
    ? Math.min(config.upper_bound!, Math.max(config.lower_bound!, numericValue))
    : config.type === 'CONTINUOUS' && finiteRange
      ? config.lower_bound!
      : 0;
  return (
    <View style={[styles.reviewField, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
      <View style={styles.fieldHeader}>
        <Text style={[styles.fieldLabel, { color: colors.text }]}>{config.name}</Text>
        {config.type !== 'FREEFORM' ? (
          <MotionPressable
            accessibilityHint="Opens a sheet to write an optional explanation for this annotation"
            accessibilityLabel={value.explanation.trim() ? `Edit the ${config.name} explanation` : `Explain the ${config.name} annotation`}
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => setExplainVisible(true)}
            style={[styles.explainButton, { backgroundColor: colors.backgroundSelected, opacity: disabled ? 0.45 : 1 }]}>
            <Text style={[styles.explainLabel, { color: colors.text }]}>Explain</Text>
          </MotionPressable>
        ) : null}
      </View>
      {config.description ? <Text style={[styles.fieldDescription, { color: colors.textSecondary }]}>{config.description}</Text> : null}
      {config.type === 'CATEGORICAL' ? (
        <View accessibilityRole="radiogroup" style={styles.choices}>
          {config.values.map((option) => {
            const selected = value.value === option.label;
            return (
              <MotionPressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled }}
                disabled={disabled}
                haptic={selected ? 'none' : 'selection'}
                key={option.label}
                onPress={() => onChange('value', option.label)}
                style={[
                  styles.choice,
                  { backgroundColor: selected ? colors.accent : colors.backgroundSelected, borderColor: selected ? colors.accent : colors.border },
                ]}>
                <Text style={[styles.choiceLabel, { color: selected ? colors.accentForeground : colors.text }]}>{option.label}</Text>
              </MotionPressable>
            );
          })}
        </View>
      ) : config.type === 'CONTINUOUS' ? (
        <>
          <TextInput
            accessibilityHint={finiteRange ? `Enter a value from ${config.lower_bound} to ${config.upper_bound}.` : 'Enter a numeric score.'}
            accessibilityLabel={`${config.name} score`}
            accessibilityValue={{
              ...(finiteRange ? { max: config.upper_bound!, min: config.lower_bound! } : {}),
              ...(Number.isFinite(numericValue) ? { now: numericValue } : {}),
              text: value.value || 'No score entered',
            }}
            editable={!disabled}
            inputMode="decimal"
            onChangeText={(text) => onChange('value', text)}
            placeholder={continuousPlaceholder(config)}
            placeholderTextColor={colors.textSecondary}
            style={[styles.numberInput, { borderColor: colors.border, color: colors.text }]}
            value={value.value}
          />
          {finiteRange ? (
            <View style={styles.sliderArea}>
              <ScoreSlider
                disabled={disabled}
                max={config.upper_bound!}
                min={config.lower_bound!}
                onValueChange={(next) => onChange('value', formatSliderValue(next, config.lower_bound!, config.upper_bound!))}
                step={sliderStep(config.lower_bound!, config.upper_bound!)}
                value={sliderValue}
              />
              <View style={styles.bounds}>
                <Text style={[styles.bound, { color: colors.textSecondary }]}>{config.lower_bound}</Text>
                <Text style={[styles.bound, { color: colors.textSecondary }]}>{config.upper_bound}</Text>
              </View>
              {!value.value.trim() ? (
                <Text style={[styles.bound, { color: colors.textSecondary }]}>Not scored yet — drag or type to set a value.</Text>
              ) : null}
            </View>
          ) : null}
        </>
      ) : (
        <TextInput
          accessibilityLabel={`${config.name} review`}
          editable={!disabled}
          multiline
          onChangeText={(text) => onChange('value', text)}
          placeholder="Enter review"
          placeholderTextColor={colors.textSecondary}
          style={[styles.textArea, { borderColor: colors.border, color: colors.text }]}
          textAlignVertical="top"
          value={value.value}
        />
      )}
      {config.type !== 'FREEFORM' && value.explanation.trim() ? (
        <Text numberOfLines={2} style={[styles.existingNote, { borderColor: colors.border, color: colors.textSecondary }]}>
          {value.explanation}
        </Text>
      ) : null}
      {config.type !== 'FREEFORM' && explainVisible ? (
        <ExplanationSheet
          configName={config.name}
          onChange={(text) => onChange('explanation', text)}
          onClose={() => setExplainVisible(false)}
          value={value.explanation}
        />
      ) : null}
    </View>
  );
}

function ExplanationSheet({ configName, onChange, onClose, value }: {
  configName: string;
  onChange: (text: string) => void;
  onClose: () => void;
  value: string;
}) {
  const colors = useAppColors();
  const inputRef = useRef<TextInput>(null);

  // autoFocus inside the native bottom sheet places the cursor without raising
  // the Android keyboard, so re-focus after the sheet has presented.
  useEffect(() => {
    const timeout = setTimeout(() => {
      inputRef.current?.blur();
      inputRef.current?.focus();
    }, 350);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <ChatBottomSheet
      onClose={onClose}
      // 'full' presents at max height on both platforms, so the keyboard never
      // clips the Done button; fractions resolve to 'half' on Android.
      snapPoints={['full']}
      subtitle="Optional context saved with this annotation."
      title={`Explain ${configName}`}
      visible>
      <View style={styles.explainSheetBody}>
        <TextInput
          accessibilityLabel={`${configName} explanation`}
          autoFocus
          multiline
          ref={inputRef}
          onChangeText={onChange}
          placeholder="Why did you choose this value?"
          placeholderTextColor={colors.textSecondary}
          style={[styles.textArea, styles.explainSheetInput, { borderColor: colors.border, color: colors.text }]}
          textAlignVertical="top"
          value={value}
        />
        <MotionPressable
          accessibilityRole="button"
          onPress={onClose}
          style={[styles.explainDone, { backgroundColor: colors.accent }]}>
          <Text style={[styles.explainDoneLabel, { color: colors.accentForeground }]}>Done</Text>
        </MotionPressable>
      </View>
    </ChatBottomSheet>
  );
}

function draftForConfig(config: SessionAnnotationConfig, value: ReviewValue | undefined): SessionAnnotationDraft {
  if (config.type === 'CATEGORICAL') {
    if (!value?.value) throw new Error(`Select a value for ${config.name}.`);
    return { type: 'CATEGORICAL', label: value.value, explanation: value.explanation };
  }
  if (config.type === 'CONTINUOUS') {
    if (!value?.value.trim()) throw new Error(`Enter a score for ${config.name}.`);
    const score = Number(value.value);
    if (!Number.isFinite(score)) throw new Error(`${config.name} must be a finite number.`);
    if (config.lower_bound != null && score < config.lower_bound) throw new Error(`${config.name} must be at least ${config.lower_bound}.`);
    if (config.upper_bound != null && score > config.upper_bound) throw new Error(`${config.name} must be at most ${config.upper_bound}.`);
    return { type: 'CONTINUOUS', score, explanation: value.explanation };
  }
  if (!value?.value.trim()) throw new Error(`Enter a review for ${config.name}.`);
  return { type: 'FREEFORM', explanation: value.value };
}

function CenterState({ action, copy, loading, onPress, title }: { action?: string; copy: string; loading?: boolean; onPress?: () => void; title?: string }) {
  const colors = useAppColors();
  return (
    <View style={styles.centerState}>
      {loading ? <ActivityIndicator color={colors.accent} /> : null}
      {title ? <Text style={[styles.stateTitle, { color: colors.text }]}>{title}</Text> : null}
      <Text style={[styles.stateCopy, { color: colors.textSecondary }]}>{copy}</Text>
      {action && onPress ? <MotionPressable accessibilityRole="button" onPress={onPress} style={[styles.stateButton, { backgroundColor: colors.accent }]}><Text style={[styles.stateButtonLabel, { color: colors.accentForeground }]}>{action}</Text></MotionPressable> : null}
    </View>
  );
}

function InlineState({ action, copy, onPress, title }: { action?: string; copy: string; onPress?: () => void; title: string }) {
  const colors = useAppColors();
  return (
    <View style={[styles.inlineState, { backgroundColor: colors.backgroundSelected, borderColor: colors.border }]}>
      <Text style={[styles.inlineTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.fieldDescription, { color: colors.textSecondary }]}>{copy}</Text>
      {action && onPress ? <MotionPressable accessibilityRole="button" onPress={onPress} style={[styles.inlineButton, { borderColor: colors.border }]}><Text style={[styles.inlineButtonLabel, { color: colors.text }]}>{action}</Text></MotionPressable> : null}
    </View>
  );
}

function UnavailableState({ message, title }: { message: string; title: string }) {
  const colors = useAppColors();
  return <View style={[styles.screen, { backgroundColor: colors.background }]}><Stack.Screen options={{ title: 'Session' }} /><CenterState title={title} copy={message} /></View>;
}

function continuousPlaceholder(config: Extract<SessionAnnotationConfig, { type: 'CONTINUOUS' }>) {
  if (config.lower_bound != null && config.upper_bound != null) return `${config.lower_bound} to ${config.upper_bound}`;
  if (config.lower_bound != null) return `${config.lower_bound} or greater`;
  if (config.upper_bound != null) return `${config.upper_bound} or less`;
  return 'Enter a number';
}

function sliderStep(lower: number, upper: number) {
  const range = upper - lower;
  if (Number.isInteger(lower) && Number.isInteger(upper) && range <= 100) return 1;
  return range / 100;
}

function formatSliderValue(value: number, lower: number, upper: number) {
  if (Number.isInteger(lower) && Number.isInteger(upper) && upper - lower <= 100) return String(Math.round(value));
  return String(Number(value.toFixed(3)));
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : 'Phoenix could not save this review.';
}

function formatDate(value: string) {
  return new Date(value).toLocaleString([], { day: 'numeric', hour: 'numeric', minute: '2-digit', month: 'short', second: '2-digit' });
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
  return `${(milliseconds / 60_000).toFixed(1)} min`;
}

function formatCount(value: number) {
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { alignSelf: 'center', maxWidth: MaxContentWidth, paddingHorizontal: 20, paddingTop: 18, width: '100%' },
  centerState: { alignItems: 'center', flex: 1, gap: 10, justifyContent: 'center', minHeight: 360, padding: 28 },
  stateTitle: { fontFamily: AppFonts.semibold, fontSize: 20, textAlign: 'center' },
  stateCopy: { fontFamily: AppFonts.regular, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  stateButton: { borderRadius: 16, justifyContent: 'center', marginTop: 8, minHeight: 48, paddingHorizontal: 20 },
  stateButtonLabel: { fontFamily: AppFonts.semibold, fontSize: 14 },
  hero: { alignItems: 'flex-start', gap: 8, paddingBottom: 22 },
  eyebrow: { fontFamily: AppFonts.semibold, fontSize: 11, letterSpacing: 0.8 },
  sessionId: { fontFamily: 'monospace', fontSize: 24, lineHeight: 31 },
  subtitle: { fontFamily: AppFonts.regular, fontSize: 13 },
  heroActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  copyButton: { borderRadius: 14, borderWidth: 1, justifyContent: 'center', marginTop: 5, minHeight: 48, paddingHorizontal: 16 },
  copyLabel: { fontFamily: AppFonts.semibold, fontSize: 13 },
  pxiButton: { alignItems: 'center', flexDirection: 'row', gap: 7, justifyContent: 'center', width: '100%' },
  pxiNote: { borderRadius: 20, borderWidth: 1, gap: 8, padding: 16 },
  pxiNotePreview: { fontFamily: AppFonts.regular, fontSize: 14, lineHeight: 21 },
  pxiNoteHeader: { alignItems: 'center', flexDirection: 'row', gap: 7, marginBottom: 4 },
  pxiNoteTitle: { flex: 1, fontFamily: AppFonts.semibold, fontSize: 15 },
  pxiNoteTime: { fontFamily: AppFonts.regular, fontSize: 11 },
  pxiNoteHint: { fontFamily: AppFonts.regular, fontSize: 12, lineHeight: 17 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { borderRadius: 16, borderWidth: 1, flexBasis: '47%', flexGrow: 1, gap: 4, minHeight: 78, padding: 14 },
  metricLabel: { fontFamily: AppFonts.medium, fontSize: 11, textTransform: 'uppercase' },
  metricValue: { fontFamily: AppFonts.semibold, fontSize: 20 },
  section: { gap: 13, paddingTop: 30 },
  conversationLead: { paddingBottom: 13 },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: AppFonts.semibold, fontSize: 21, letterSpacing: -0.3 },
  sectionMeta: { fontFamily: AppFonts.medium, fontSize: 13 },
  sectionLoader: { paddingVertical: 40 },
  turnSeparator: { height: 13 },
  turn: { borderRadius: 20, borderWidth: 1, gap: 12, padding: 16 },
  turnHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  turnTitle: { fontFamily: AppFonts.semibold, fontSize: 16 },
  turnTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  errorChip: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  errorChipLabel: { color: '#FFFFFF', fontFamily: AppFonts.semibold, fontSize: 10, letterSpacing: 0.3, textTransform: 'uppercase' },
  turnErrorMessage: { fontFamily: AppFonts.regular, fontSize: 11, marginTop: 3, maxWidth: 240 },
  turnTime: { fontFamily: AppFonts.regular, fontSize: 11, marginTop: 3 },
  traceButton: { borderRadius: 13, justifyContent: 'center', minHeight: 48, paddingHorizontal: 15 },
  traceLabel: { fontFamily: AppFonts.semibold, fontSize: 13 },
  message: { borderRadius: 16, gap: 8, padding: 14 },
  messageLabel: { fontFamily: AppFonts.semibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase' },
  messageText: { fontFamily: AppFonts.regular, fontSize: 14, lineHeight: 21 },
  expandButton: { alignItems: 'center', alignSelf: 'flex-start', borderRadius: 12, borderWidth: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: 14 },
  expandLabel: { fontFamily: AppFonts.semibold, fontSize: 12 },
  truncated: { fontFamily: AppFonts.regular, fontSize: 11 },
  missingIo: { fontFamily: AppFonts.regular, fontSize: 13, fontStyle: 'italic' },
  inlineState: { alignItems: 'flex-start', borderRadius: 16, borderWidth: 1, gap: 6, padding: 15 },
  inlineTitle: { fontFamily: AppFonts.semibold, fontSize: 15 },
  inlineButton: { borderRadius: 13, borderWidth: 1, justifyContent: 'center', marginTop: 5, minHeight: 48, paddingHorizontal: 15 },
  inlineButtonLabel: { fontFamily: AppFonts.semibold, fontSize: 13 },
  reviewFields: { gap: 14 },
  readOnly: { borderRadius: 16, borderWidth: 1, gap: 5, padding: 15 },
  readOnlyTitle: { fontFamily: AppFonts.semibold, fontSize: 15 },
  reviewField: { borderRadius: 20, borderWidth: 1, gap: 10, padding: 16 },
  fieldLabel: { flexShrink: 1, fontFamily: AppFonts.semibold, fontSize: 17 },
  fieldDescription: { fontFamily: AppFonts.regular, fontSize: 13, lineHeight: 18 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { alignItems: 'center', borderRadius: 16, borderWidth: 1, justifyContent: 'center', minHeight: 50, minWidth: 76, paddingHorizontal: 16 },
  choiceLabel: { fontFamily: AppFonts.semibold, fontSize: 14 },
  numberInput: { borderRadius: 14, borderWidth: 1, fontFamily: AppFonts.medium, fontSize: 16, minHeight: 50, paddingHorizontal: 14 },
  sliderArea: { gap: 2 },
  bounds: { flexDirection: 'row', justifyContent: 'space-between' },
  bound: { fontFamily: AppFonts.regular, fontSize: 11 },
  existingNote: { borderLeftWidth: 2, fontFamily: AppFonts.regular, fontSize: 13, fontStyle: 'italic', lineHeight: 19, paddingLeft: 10 },
  textArea: { borderRadius: 14, borderWidth: 1, fontFamily: AppFonts.regular, fontSize: 15, lineHeight: 21, minHeight: 112, padding: 13 },
  fieldHeader: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
  explainButton: { alignItems: 'center', borderRadius: 13, justifyContent: 'center', minHeight: 48, paddingHorizontal: 15 },
  explainLabel: { fontFamily: AppFonts.semibold, fontSize: 13 },
  explainSheetBody: { gap: 12 },
  explainSheetInput: { maxHeight: 260, minHeight: 150 },
  explainDone: { alignItems: 'center', borderRadius: 16, justifyContent: 'center', minHeight: 50 },
  explainDoneLabel: { fontFamily: AppFonts.semibold, fontSize: 15 },
  error: { fontFamily: AppFonts.medium, fontSize: 13, lineHeight: 19 },
  submitActions: { flexDirection: 'row', gap: 10 },
  secondarySubmit: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 52, paddingHorizontal: 10 },
  secondarySubmitLabel: { fontFamily: AppFonts.semibold, fontSize: 14 },
  primarySubmit: { alignItems: 'center', borderRadius: 16, flex: 1.25, justifyContent: 'center', minHeight: 52, paddingHorizontal: 10 },
  primarySubmitLabel: { fontFamily: AppFonts.semibold, fontSize: 14 },
});

import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { MotionPressable } from '@/components/motion-pressable';
import { EmptyState } from '@/components/ui/empty-state';
import { RowInset, RowSeparator } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { StatusLabel, type StatusTone } from '@/components/ui/status-label';
import { AppFonts, Type, useAppColors } from '@/constants/theme';
import { latestOwnedAnnotation } from '@/features/session-review/classifier';
import {
  createAuthenticatedAnnotationIdentifier,
  createSessionReviewIdentifier,
} from '@/features/session-review/api';
import type {
  SessionAnnotation,
  SessionAnnotationConfig,
  SessionAnnotationDraft,
  SessionReviewClassification,
  SessionTurn,
} from '@/features/session-review/types';
import type { usePhoenixViewer } from '@/hooks/use-phoenix-data';
import {
  type usePhoenixSessionPxiNotes,
  useWritePhoenixSessionAnnotations,
  useWritePhoenixSessionNote,
} from '@/hooks/use-phoenix-sessions';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';

import {
  draftForConfig,
  EMPTY_REVIEW_VALUE,
  ReviewControl,
  type ReviewValue,
} from './review-control';
import { PxiNotesSection } from './review-pxi-notes';
import type { LoadedSession, SessionQueueFilter } from './session-detail-types';

const REVIEW_SAVE_ERROR = 'Phoenix could not save this review.';

type ViewerQuery = ReturnType<typeof usePhoenixViewer>;

/** PXI's notes, then the human review form. */
export function ReviewTools({
  allAnnotations,
  annotationsError,
  annotationsSuccess,
  anonymousReviewerId,
  classification,
  configs,
  configsError,
  configsSuccess,
  instanceId,
  onReviewed,
  projectId,
  pxiNotes,
  queueFilter,
  retry,
  session,
  staleNames,
  turns,
  viewer,
}: {
  allAnnotations: SessionAnnotation[];
  annotationsError: Error | null;
  annotationsSuccess: boolean;
  anonymousReviewerId?: string;
  classification: SessionReviewClassification;
  configs: SessionAnnotationConfig[];
  configsError: Error | null;
  configsSuccess: boolean;
  instanceId: string;
  onReviewed?: () => void;
  projectId: string;
  pxiNotes: ReturnType<typeof usePhoenixSessionPxiNotes>;
  queueFilter?: SessionQueueFilter;
  retry: () => Promise<void>;
  session: LoadedSession;
  staleNames: string[];
  turns: SessionTurn[];
  viewer: ViewerQuery;
}) {
  return (
    <>
      <PxiNotesSection notes={pxiNotes} turns={turns} />
      <ReviewForm
        allAnnotations={allAnnotations}
        annotationsError={annotationsError}
        annotationsSuccess={annotationsSuccess}
        anonymousReviewerId={anonymousReviewerId}
        classification={classification}
        configs={configs}
        configsError={configsError}
        configsSuccess={configsSuccess}
        key={session.session_id}
        onReviewed={onReviewed}
        projectId={projectId}
        queueFilter={queueFilter}
        retry={retry}
        routeInstanceId={instanceId}
        sessionId={session.session_id}
        staleNames={staleNames}
        viewer={viewer.data}
        viewerError={viewer.error}
        viewerSuccess={viewer.isSuccess}
      />
    </>
  );
}

function ReviewForm({
  allAnnotations,
  annotationsError,
  annotationsSuccess,
  anonymousReviewerId,
  classification,
  configs,
  configsError,
  configsSuccess,
  onReviewed,
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
  classification: SessionReviewClassification;
  configs: SessionAnnotationConfig[];
  configsError: Error | null;
  configsSuccess: boolean;
  onReviewed?: () => void;
  projectId: string;
  queueFilter?: SessionQueueFilter;
  retry: () => Promise<void>;
  routeInstanceId: string;
  sessionId: string;
  staleNames: string[];
  viewer: ViewerQuery['data'];
  viewerError: Error | null;
  viewerSuccess: boolean;
}) {
  const colors = useAppColors();

  const instance = useInstanceStore((state) =>
    state.instances.find((item) => item.id === routeInstanceId),
  );

  const writeAnnotations = useWritePhoenixSessionAnnotations(instance, projectId);
  const writeNote = useWritePhoenixSessionNote(instance, projectId);
  const [values, setValues] = useState<Record<string, ReviewValue>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pristine, setPristine] = useState(true);
  const initializedSource = useRef('');
  const authenticatedViewerId = viewer && viewer.auth_method !== 'ANONYMOUS' ? viewer.id : null;

  const annotationIdentifier =
    viewer?.auth_method === 'ANONYMOUS'
      ? anonymousReviewerId
        ? createSessionReviewIdentifier('annotation', anonymousReviewerId)
        : null
      : authenticatedViewerId
        ? createAuthenticatedAnnotationIdentifier(authenticatedViewerId)
        : null;

  const noteOwner =
    viewer?.auth_method === 'ANONYMOUS' ? anonymousReviewerId : authenticatedViewerId;

  const noteIdentifier = noteOwner ? createSessionReviewIdentifier('note', noteOwner) : null;
  const readOnly = viewer?.auth_method !== 'ANONYMOUS' && viewer?.role === 'VIEWER';

  const canSubmit = Boolean(
    annotationIdentifier &&
    noteIdentifier &&
    !readOnly &&
    configs.length > 0 &&
    staleNames.length === 0 &&
    configsSuccess &&
    annotationsSuccess &&
    viewerSuccess,
  );

  const existingNote = noteIdentifier
    ? latestOwnedAnnotation(allAnnotations, 'note', noteIdentifier, authenticatedViewerId)
    : undefined;

  useEffect(() => {
    if (
      !annotationsSuccess ||
      !configsSuccess ||
      !viewerSuccess ||
      !pristine ||
      !annotationIdentifier
    )
      return;

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
        authenticatedViewerId,
      );

      nextValues[config.name] = {
        explanation: config.type === 'FREEFORM' ? '' : (current?.result?.explanation ?? ''),
        value:
          config.type === 'CATEGORICAL'
            ? (current?.result?.label ?? '')
            : config.type === 'CONTINUOUS' && current?.result?.score != null
              ? String(current.result.score)
              : config.type === 'FREEFORM'
                ? (current?.result?.explanation ?? '')
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
      [name]: { ...(current[name] ?? EMPTY_REVIEW_VALUE), [field]: value },
    }));
  };

  const submit = async (moveNext: boolean) => {
    if (!annotationIdentifier || !noteIdentifier || !canSubmit) return;
    setError(null);
    let drafts: { config: SessionAnnotationConfig; draft: SessionAnnotationDraft }[];

    try {
      drafts = configs.map((config) => ({
        config,
        draft: draftForConfig(config, values[config.name]),
      }));
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : REVIEW_SAVE_ERROR);
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

      if (moveNext && !onReviewed) {
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

        // The host usually selects another session, which remounts this form;
        // the reset above covers a host that keeps the same one on screen.
        if (moveNext) onReviewed?.();
      }
    } catch (submissionError) {
      const message =
        submissionError instanceof Error ? submissionError.message : REVIEW_SAVE_ERROR;

      setError(
        `${message} Your entries are still here; retrying updates the same current-viewer values.`,
      );
      haptics.error();
    }
  };

  const submitting = writeAnnotations.isPending || writeNote.isPending;
  const enabled = canSubmit && !submitting;
  const prepareError = configsError ?? annotationsError ?? viewerError;
  const completed = new Set(classification.completedConfigNames);

  const label =
    configs.length > 0
      ? `Review · ${classification.completedConfigNames.length} of ${configs.length} complete`
      : 'Review';

  return (
    <View>
      <SectionHeader label={label} />

      {prepareError ? (
        <EmptyState
          action={{ label: 'Try again', onPress: () => void retry() }}
          fill={false}
          message={prepareError.message}
          symbol={{ android: 'warning', ios: 'exclamationmark.triangle', web: 'warning' }}
          title="Couldn’t prepare this review"
        />
      ) : !configsSuccess || !annotationsSuccess || !viewerSuccess ? (
        <EmptyState fill={false} loading title="Preparing review" />
      ) : configs.length === 0 || staleNames.length > 0 ? (
        <EmptyState
          action={{
            label: 'Edit queue',
            onPress: () =>
              router.push({
                pathname: '/instances/[id]/projects/[projectId]/sessions/settings',
                params: { id: routeInstanceId, projectId },
              }),
          }}
          fill={false}
          message={
            staleNames.length > 0
              ? `${staleNames.join(', ')} no longer exist. Update the queue before reviewing.`
              : 'Choose one or more annotation configs to define a complete review.'
          }
          symbol={{ android: 'checklist', ios: 'checklist', web: 'checklist' }}
          title={staleNames.length > 0 ? 'Queue configuration is stale' : 'Queue not configured'}
        />
      ) : (
        <>
          {readOnly ? (
            <Notice
              message="Your Phoenix Viewer role can browse this queue but cannot submit annotations or notes."
              title="Read-only access"
              tone="neutral"
            />
          ) : !annotationIdentifier || !noteIdentifier ? (
            <Notice
              message="Refresh after authentication is restored before submitting a review."
              title="Viewer identity unavailable"
              tone="error"
            />
          ) : null}

          {classification.invalidConfigNames.length > 0 ? (
            <Notice
              message={`${classification.invalidConfigNames.join(', ')} ${
                classification.invalidConfigNames.length === 1
                  ? 'has an annotation that doesn’t'
                  : 'have annotations that don’t'
              } match the current configuration, such as an out-of-range score or a removed label. Submitting a valid value completes that part of the review.`}
              title="Why this session needs attention"
              tone="error"
            />
          ) : null}

          <View style={styles.fields}>
            {configs.map((config, index) => (
              <View key={config.id}>
                {index > 0 ? <RowSeparator inset={0} /> : null}
                <ReviewControl
                  complete={completed.has(config.name)}
                  config={config}
                  disabled={!enabled}
                  onChange={(field, value) => update(config.name, field, value)}
                  value={values[config.name] ?? EMPTY_REVIEW_VALUE}
                />
              </View>
            ))}
            <RowSeparator inset={0} />
            <View style={styles.noteField}>
              <Text style={[Type.headline, { color: colors.text }]}>Note</Text>
              <Text style={[Type.subhead, { color: colors.textSecondary }]}>
                {existingNote
                  ? 'You saved a note for this session. New text replaces it; leaving this empty keeps it.'
                  : 'Optional context for other reviewers. Notes never mark a session reviewed.'}
              </Text>
              {existingNote?.result?.explanation ? (
                <Text
                  numberOfLines={4}
                  style={[
                    Type.subhead,
                    styles.quote,
                    { borderLeftColor: colors.border, color: colors.textSecondary },
                  ]}
                >
                  {existingNote.result.explanation}
                </Text>
              ) : null}
              <TextInput
                accessibilityLabel="Optional session note"
                editable={enabled}
                multiline
                onChangeText={(value) => {
                  setPristine(false);
                  setNote(value);
                }}
                placeholder="Add context for other reviewers"
                placeholderTextColor={colors.textTertiary}
                style={[styles.textArea, { borderColor: colors.border, color: colors.text }]}
                textAlignVertical="top"
                value={note}
              />
            </View>
          </View>

          <View style={styles.submit}>
            {error ? (
              <Text accessibilityRole="alert" style={[Type.subhead, { color: colors.danger }]}>
                {error}
              </Text>
            ) : null}
            <MotionPressable
              accessibilityRole="button"
              accessibilityState={{ busy: submitting, disabled: !enabled }}
              disabled={!enabled}
              onPress={() => void submit(true)}
              style={[
                styles.primary,
                { backgroundColor: colors.accent },
                !enabled && styles.receded,
              ]}
            >
              <Text style={[styles.primaryLabel, { color: colors.accentForeground }]}>
                {submitting ? 'Saving…' : onReviewed ? 'Submit & next' : 'Submit & back to queue'}
              </Text>
            </MotionPressable>
            <Pressable
              accessibilityHint="Saves the review and keeps this session open"
              accessibilityRole="button"
              accessibilityState={{ disabled: !enabled }}
              disabled={!enabled}
              onPress={() => {
                haptics.selection();
                void submit(false);
              }}
              style={({ pressed }) => [styles.secondary, (pressed || !enabled) && styles.receded]}
            >
              <Text style={[styles.secondaryLabel, { color: colors.text }]}>Submit and stay</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

/** A flat notice: a status symbol, a title, and an explanation. No panel. */
function Notice({ message, title, tone }: { message: string; title: string; tone: StatusTone }) {
  const colors = useAppColors();

  return (
    <View accessible style={styles.notice}>
      <View style={styles.noticeTitle}>
        <StatusLabel tone={tone} />
        <Text style={[Type.headline, styles.noticeText, { color: colors.text }]}>{title}</Text>
      </View>
      <Text style={[Type.subhead, { color: colors.textSecondary }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { paddingHorizontal: RowInset },
  notice: { gap: 4, paddingHorizontal: RowInset, paddingVertical: 12 },
  noticeTitle: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  noticeText: { flex: 1 },
  noteField: { gap: 10, paddingVertical: 16 },
  quote: { borderLeftWidth: 2, paddingLeft: 10 },
  textArea: {
    ...Type.body,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 104,
    padding: 12,
  },
  submit: { gap: 4, paddingHorizontal: RowInset, paddingTop: 12 },
  primary: {
    alignItems: 'center',
    borderRadius: 26,
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 52,
    paddingHorizontal: 20,
  },
  primaryLabel: { fontFamily: AppFonts.semibold, fontSize: 16 },
  secondary: { alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  secondaryLabel: { fontFamily: AppFonts.medium, fontSize: 15 },
  receded: { opacity: 0.45 },
});

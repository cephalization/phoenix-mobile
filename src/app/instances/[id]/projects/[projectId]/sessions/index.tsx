import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DuoArrangement } from '@/components/duo/arrangement';
import { ContentColumn } from '@/components/duo/content-column';
import { MotionPressable } from '@/components/motion-pressable';
import { usePxiHeaderOptions } from '@/components/pxi-header-button';
import {
  SessionDetailView,
  SessionPane,
  type SessionQueueFilter,
} from '@/components/sessions/session-detail';
import { AppFonts, useAppColors } from '@/constants/theme';
import { nativeHeaderTitle, useDuoLayout } from '@/features/duo/layout';
import { classifySessionReview } from '@/features/session-review/classifier';
import type { SessionData, SessionReviewClassification } from '@/features/session-review/types';
import { usePhoenixProjects } from '@/hooks/use-phoenix-data';
import {
  usePhoenixProjectAnnotationConfigs,
  usePhoenixProjectSessions,
  usePhoenixSessionAnnotations,
} from '@/hooks/use-phoenix-sessions';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';
import {
  getSessionReviewQueueSettings,
  useSessionReviewSettingsStore,
} from '@/store/session-review-settings';

const FILTERS: { label: string; value: SessionQueueFilter }[] = [
  { label: 'Needs review', value: 'needs-review' },
  { label: 'All', value: 'all' },
  { label: 'Reviewed', value: 'reviewed' },
];

/** Queue share of the regular-width split; the selected session takes the rest. */
const QUEUE_SPLIT_RATIO = 0.42;

export default function SessionsScreen() {
  const {
    filter: routeFilter,
    id,
    projectId,
  } = useLocalSearchParams<{
    filter?: SessionQueueFilter;
    id: string;
    projectId: string;
  }>();

  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { isRegularWidth, systemBarEdge } = useDuoLayout();

  const [requestedFilter, setFilter] = useState<SessionQueueFilter>(
    FILTERS.some((option) => option.value === routeFilter) ? routeFilter! : 'needs-review',
  );

  const [manualRefreshing, setManualRefreshing] = useState(false);

  // Regular width shows the chosen session beside the queue instead of pushing
  // it; the selection falls back to the first visible row so the pane is never
  // empty while the list has content.
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const instance = useInstanceStore((state) => state.instances.find((item) => item.id === id));
  const projects = usePhoenixProjects(instance);
  const project = projects.data?.find((candidate) => candidate.id === projectId);
  const sessionsQuery = usePhoenixProjectSessions(instance, projectId);
  const configsQuery = usePhoenixProjectAnnotationConfigs(instance, projectId);
  const queues = useSessionReviewSettingsStore((state) => state.queues);
  const settings = getSessionReviewQueueSettings(queues, id, projectId);

  const sessions = deduplicateSessions(
    sessionsQuery.data?.pages.flatMap((page) => page.items) ?? [],
  );

  const sessionIdPages = (sessionsQuery.data?.pages ?? []).map((page) =>
    page.items.map((session) => session.session_id),
  );

  const annotationsQuery = usePhoenixSessionAnnotations(
    instance,
    projectId,
    sessionIdPages,
    settings.requiredConfigNames,
  );

  const configs = configsQuery.data ?? [];
  const availableNames = new Set(configs.map((config) => config.name));
  const staleNames = settings.requiredConfigNames.filter((name) => !availableNames.has(name));
  const queueConfigured = settings.requiredConfigNames.length > 0 && staleNames.length === 0;

  // Without a configured queue the default tab has nothing to show, so fall
  // back to every session until one is set up.
  const filter: SessionQueueFilter =
    requestedFilter === 'needs-review' && settings.requiredConfigNames.length === 0
      ? 'all'
      : requestedFilter;

  const dataError =
    sessionsQuery.error ??
    configsQuery.error ??
    (annotationsQuery.isEnabled ? annotationsQuery.error : null);

  const annotationsReady = !queueConfigured || annotationsQuery.isSuccess;
  const dependenciesReady = sessionsQuery.isSuccess && configsQuery.isSuccess && annotationsReady;
  const annotationsBySessionId = new Map<string, typeof annotationsQuery.data>();

  for (const annotation of annotationsQuery.data ?? []) {
    const sessionAnnotations = annotationsBySessionId.get(annotation.session_id) ?? [];
    sessionAnnotations.push(annotation);
    annotationsBySessionId.set(annotation.session_id, sessionAnnotations);
  }

  const rows =
    !dataError && dependenciesReady
      ? sessions.map((session) => {
          return {
            classification: classifySessionReview(
              settings.requiredConfigNames,
              configs,
              annotationsBySessionId.get(session.session_id) ?? [],
            ),
            session,
          };
        })
      : [];

  const filteredRows = rows.filter(({ classification }) => {
    if (!queueConfigured && filter === 'needs-review') return false;

    if (filter === 'all') return true;

    return filter === 'reviewed'
      ? classification.status === 'complete'
      : classification.status !== 'complete';
  });

  const loading =
    !dataError && (sessionsQuery.isPending || configsQuery.isPending || !annotationsReady);

  const activeSessionId =
    isRegularWidth && filteredRows.length > 0
      ? filteredRows.some((row) => row.session.id === selectedSessionId)
        ? selectedSessionId
        : filteredRows[0].session.id
      : null;

  // PXI replaces the detail pane, so the session it showed moves onto the stack.
  const moveSessionToStack = () => {
    if (activeSessionId === null) return;

    router.push({
      pathname: '/instances/[id]/projects/[projectId]/sessions/[sessionId]',
      params: { id, projectId, sessionId: activeSessionId, queueFilter: filter },
    });
  };

  const pxiHeader = usePxiHeaderOptions(instance, moveSessionToStack);

  if (!instance)
    return (
      <UnavailableState
        title="Instance not found"
        message="This Phoenix connection is no longer on this device."
      />
    );

  if (projects.isSuccess && !project)
    return (
      <UnavailableState title="Project not found" message="This project is no longer available." />
    );

  const refresh = async () => {
    if (manualRefreshing) return;
    haptics.selection();
    setManualRefreshing(true);

    try {
      const results = await Promise.all([sessionsQuery.refetch(), configsQuery.refetch()]);
      const annotationResult = annotationsQuery.isEnabled ? await annotationsQuery.refetch() : null;

      if (results.some((result) => result.isError) || annotationResult?.isError) haptics.error();
      else haptics.light();
    } finally {
      setManualRefreshing(false);
    }
  };

  const openSession = (sessionId: string) => {
    if (isRegularWidth) {
      setSelectedSessionId(sessionId);

      return;
    }

    router.push({
      pathname: '/instances/[id]/projects/[projectId]/sessions/[sessionId]',
      params: {
        id,
        projectId,
        sessionId,
        queueFilter: filter,
      },
    });
  };

  // After "Submit & next" the reviewed row may leave the Needs review list once
  // annotations refetch, so the next row is chosen now, while it is still here.
  const selectNextSession = () => {
    const index = filteredRows.findIndex((row) => row.session.id === activeSessionId);
    setSelectedSessionId(filteredRows[index + 1]?.session.id ?? null);
  };

  const list = (
    <ContentColumn padding={20}>
      {(column) => (
        <FlatList
          contentContainerStyle={[styles.content, column, { paddingBottom: 24 + insets.bottom }]}
          contentInsetAdjustmentBehavior="automatic"
          data={filteredRows}
          initialNumToRender={12}
          keyExtractor={({ session }) => session.id}
          ListHeaderComponent={
            <View style={styles.header}>
              <View style={styles.intro}>
                <Text style={[styles.title, { color: colors.text }]}>Sessions</Text>
                <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                  Recent conversations, separated from local PXI history.
                </Text>
              </View>
              <QueueSetupCard
                configured={queueConfigured}
                requiredCount={settings.requiredConfigNames.length}
                staleNames={staleNames}
                onPress={() =>
                  router.push({
                    pathname: '/instances/[id]/projects/[projectId]/sessions/settings',
                    params: { id, projectId },
                  })
                }
              />
              <ScrollView
                contentContainerStyle={styles.filters}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filterScroller}
              >
                {FILTERS.map((option) => {
                  const selected = option.value === filter;

                  return (
                    <MotionPressable
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      haptic={selected ? 'none' : 'selection'}
                      key={option.value}
                      onPress={() => setFilter(option.value)}
                      style={[
                        styles.filter,
                        {
                          backgroundColor: selected ? colors.accent : colors.backgroundSelected,
                          borderColor: selected ? colors.accent : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.filterLabel,
                          { color: selected ? colors.accentForeground : colors.text },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </MotionPressable>
                  );
                })}
              </ScrollView>
            </View>
          }
          ListEmptyComponent={
            <SessionListState
              dataError={dataError}
              filter={filter}
              hasNextPage={Boolean(sessionsQuery.hasNextPage)}
              hasSessions={sessions.length > 0}
              loading={loading}
              queueConfigured={queueConfigured}
              retry={() => void refresh()}
              scan={() => sessionsQuery.fetchNextPage()}
            />
          }
          ListFooterComponent={
            sessionsQuery.isFetchingNextPage ? (
              <ActivityIndicator color={colors.accent} style={styles.footer} />
            ) : filteredRows.length > 0 && sessionsQuery.hasNextPage ? (
              <MotionPressable
                accessibilityRole="button"
                onPress={() => sessionsQuery.fetchNextPage()}
                style={[styles.continueButton, { borderColor: colors.border }]}
              >
                <Text style={[styles.continueLabel, { color: colors.text }]}>
                  Scan older sessions
                </Text>
              </MotionPressable>
            ) : filteredRows.length > 0 ? (
              <Text style={[styles.listEnd, { color: colors.textSecondary }]}>
                All loaded sessions shown
              </Text>
            ) : null
          }
          maxToRenderPerBatch={12}
          refreshControl={
            <RefreshControl
              colors={[colors.brand]}
              onRefresh={refresh}
              progressBackgroundColor={colors.backgroundElement}
              refreshing={manualRefreshing}
              tintColor={colors.brand}
            />
          }
          removeClippedSubviews={Platform.OS === 'android'}
          renderItem={({ item }) => (
            <SessionRow
              {...item}
              onPress={() => openSession(item.session.id)}
              selected={item.session.id === activeSessionId}
            />
          )}
          windowSize={7}
        />
      )}
    </ContentColumn>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerBackTitle: project?.name ?? 'Project',
          title: nativeHeaderTitle(systemBarEdge, 'Sessions'),
          ...pxiHeader,
        }}
      />
      {isRegularWidth ? (
        <DuoArrangement
          preferredAxis="horizontal"
          primary={list}
          ratio={QUEUE_SPLIT_RATIO}
          secondary={
            <SessionPane>
              {activeSessionId ? (
                <SessionDetailView
                  embedded
                  instanceId={id}
                  key={activeSessionId}
                  onReviewed={selectNextSession}
                  projectId={projectId}
                  queueFilter={filter}
                  sessionId={activeSessionId}
                />
              ) : (
                <View style={styles.paneEmpty}>
                  <State
                    title="Select a session"
                    copy="Choose a session from the queue to read its conversation and review it here."
                  />
                </View>
              )}
            </SessionPane>
          }
        />
      ) : (
        list
      )}
    </View>
  );
}

function QueueSetupCard({
  configured,
  onPress,
  requiredCount,
  staleNames,
}: {
  configured: boolean;
  onPress: () => void;
  requiredCount: number;
  staleNames: string[];
}) {
  const colors = useAppColors();

  const title = configured
    ? `${requiredCount} required annotation${requiredCount === 1 ? '' : 's'}`
    : staleNames.length > 0
      ? 'Queue needs attention'
      : 'Set up review queue';

  const copy = configured
    ? 'Selected configurations define when a session is reviewed.'
    : staleNames.length > 0
      ? `${staleNames.join(', ')} ${staleNames.length === 1 ? 'was' : 'were'} removed from this project.`
      : 'Choose one or more project annotation configurations to define completion.';

  return (
    <MotionPressable
      accessibilityHint="Opens review queue settings"
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.queueCard,
        {
          backgroundColor: colors.backgroundElement,
          borderColor: configured ? colors.border : colors.brand,
        },
      ]}
    >
      <View style={styles.queueCopy}>
        <Text
          style={[styles.queueEyebrow, { color: configured ? colors.success : colors.brandText }]}
        >
          Human review queue
        </Text>
        <Text style={[styles.queueTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.queueDescription, { color: colors.textSecondary }]}>{copy}</Text>
      </View>
      <Text style={[styles.queueAction, { color: colors.text }]}>
        {configured ? 'Edit' : 'Set up'}
      </Text>
    </MotionPressable>
  );
}

function SessionRow({
  classification,
  onPress,
  selected,
  session,
}: {
  classification: SessionReviewClassification;
  onPress: () => void;
  /** Shown beside the list on regular width; compact rows are never selected. */
  selected: boolean;
  session: SessionData;
}) {
  const colors = useAppColors();
  const status = reviewLabel(classification);

  const duration = Math.max(
    0,
    new Date(session.end_time).getTime() - new Date(session.start_time).getTime(),
  );

  return (
    <MotionPressable
      accessibilityHint="Opens session details and review"
      accessibilityLabel={`Session ${session.session_id}, ${status}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.sessionRow,
        selected ? styles.sessionRowSelected : null,
        {
          backgroundColor: selected ? colors.backgroundSelected : 'transparent',
          borderBottomColor: selected ? 'transparent' : colors.border,
        },
      ]}
    >
      <View style={styles.rowTop}>
        <Text numberOfLines={2} selectable style={[styles.sessionId, { color: colors.text }]}>
          {session.session_id}
        </Text>
        {classification.status !== 'not-configured' ? (
          <View style={[styles.statusBadge, { backgroundColor: colors.backgroundSelected }]}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    classification.status === 'complete'
                      ? colors.success
                      : classification.status === 'partial'
                        ? colors.brand
                        : colors.textSecondary,
                },
              ]}
            />
            <Text
              style={[
                styles.statusText,
                {
                  color:
                    classification.status === 'complete' ? colors.success : colors.textSecondary,
                },
              ]}
            >
              {status}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.started, { color: colors.textSecondary }]}>
        {formatDate(session.start_time)}
      </Text>
      <View style={styles.metadata}>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {session.traces.length} trace{session.traces.length === 1 ? '' : 's'}
        </Text>
        <Text style={[styles.metaDot, { color: colors.textSecondary }]}>·</Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {formatDuration(duration)}
        </Text>
        <Text style={[styles.metaDot, { color: colors.textSecondary }]}>·</Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {formatCount(session.token_count_total ?? 0)} tokens
        </Text>
        {classification.requiredConfigNames.length > 0 ? (
          <Text style={[styles.completion, { color: colors.textSecondary }]}>
            {classification.completedConfigNames.length}/{classification.requiredConfigNames.length}
          </Text>
        ) : null}
      </View>
    </MotionPressable>
  );
}

function SessionListState({
  dataError,
  filter,
  hasNextPage,
  hasSessions,
  loading,
  queueConfigured,
  retry,
  scan,
}: {
  dataError: Error | null;
  filter: SessionQueueFilter;
  hasNextPage: boolean;
  hasSessions: boolean;
  loading: boolean;
  queueConfigured: boolean;
  retry: () => void;
  scan: () => void;
}) {
  const colors = useAppColors();

  if (dataError)
    return (
      <State
        title="Couldn’t load sessions"
        copy={dataError.message}
        action="Try again"
        onPress={retry}
      />
    );

  if (loading) return <ActivityIndicator color={colors.accent} style={styles.stateLoader} />;

  if (!queueConfigured && filter === 'needs-review')
    return (
      <State
        title="Queue not configured"
        copy="Set up required annotations before using Needs review. All sessions remain available in the All view."
      />
    );

  if (!hasSessions)
    return (
      <State
        title="No remote sessions yet"
        copy="Sessions will appear when this Phoenix project receives traces with session IDs."
      />
    );

  if (hasNextPage)
    return (
      <State
        title={filter === 'reviewed' ? 'No reviewed sessions yet' : 'Queue is clear so far'}
        copy="The newest sessions are checked. Older sessions haven’t been scanned yet."
        action="Scan older sessions"
        onPress={scan}
      />
    );

  return (
    <State
      title={filter === 'reviewed' ? 'No reviewed sessions' : 'Queue is clear'}
      copy={
        filter === 'reviewed'
          ? 'No loaded session has all required human annotations.'
          : 'Every available session has all required human annotations.'
      }
    />
  );
}

function State({
  action,
  copy,
  onPress,
  title,
}: {
  action?: string;
  copy: string;
  onPress?: () => void;
  title: string;
}) {
  const colors = useAppColors();

  return (
    <View style={styles.state}>
      <Text style={[styles.stateTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.stateCopy, { color: colors.textSecondary }]}>{copy}</Text>
      {action && onPress ? (
        <MotionPressable
          accessibilityRole="button"
          onPress={onPress}
          style={[styles.primaryButton, { backgroundColor: colors.accent }]}
        >
          <Text style={[styles.primaryLabel, { color: colors.accentForeground }]}>{action}</Text>
        </MotionPressable>
      ) : null}
    </View>
  );
}

function UnavailableState({ message, title }: { message: string; title: string }) {
  const colors = useAppColors();

  return (
    <View style={[styles.unavailable, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Sessions' }} />
      <State title={title} copy={message} />
    </View>
  );
}

function deduplicateSessions(sessions: SessionData[]) {
  return [...new Map(sessions.map((session) => [session.id, session])).values()];
}

function reviewLabel(classification: SessionReviewClassification) {
  if (classification.status === 'not-configured') return 'Not configured';

  if (classification.status === 'complete') return 'Reviewed';

  if (classification.status === 'partial') return 'Partial';

  if (classification.status === 'stale') return 'Needs attention';

  return 'Needs review';
}

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  });
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 1000) return `${Math.max(0, Math.round(milliseconds))} ms`;

  if (milliseconds < 60_000)
    return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;

  return `${Math.round(milliseconds / 60_000)} min`;
}

function formatCount(value: number) {
  if (value < 1000) return String(Math.round(value));

  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;

  return `${(value / 1_000_000).toFixed(1)}m`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  unavailable: { flex: 1, justifyContent: 'center' },
  content: { alignSelf: 'center', width: '100%' },
  header: { paddingTop: 18 },
  intro: { gap: 6, paddingBottom: 20 },
  title: { fontFamily: AppFonts.semibold, fontSize: 32, letterSpacing: -1 },
  subtitle: { fontFamily: AppFonts.regular, fontSize: 15, lineHeight: 21 },
  queueCard: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    minHeight: 116,
    padding: 16,
  },
  queueCopy: { flex: 1, gap: 4 },
  queueEyebrow: {
    fontFamily: AppFonts.semibold,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  queueTitle: { fontFamily: AppFonts.semibold, fontSize: 17 },
  queueDescription: { fontFamily: AppFonts.regular, fontSize: 13, lineHeight: 18 },
  queueAction: { fontFamily: AppFonts.semibold, fontSize: 13 },
  filterScroller: { marginHorizontal: -20 },
  filters: { gap: 8, paddingHorizontal: 20, paddingVertical: 18 },
  filter: {
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 17,
  },
  filterLabel: { fontFamily: AppFonts.medium, fontSize: 13 },
  sessionRow: {
    borderBottomWidth: 1,
    gap: 6,
    minHeight: 122,
    paddingHorizontal: 2,
    paddingVertical: 16,
  },
  // The highlight bleeds 10pt past the text on each side while the text keeps its offset.
  sessionRowSelected: { borderRadius: 16, marginHorizontal: -10, paddingHorizontal: 12 },
  rowTop: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  sessionId: { flex: 1, fontFamily: 'monospace', fontSize: 14, lineHeight: 19 },
  statusBadge: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 6,
    minHeight: 28,
    paddingHorizontal: 9,
  },
  statusDot: { borderRadius: 4, height: 7, width: 7 },
  statusText: { fontFamily: AppFonts.medium, fontSize: 11 },
  started: { fontFamily: AppFonts.regular, fontSize: 12 },
  metadata: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingTop: 4 },
  meta: { fontFamily: AppFonts.regular, fontSize: 12 },
  metaDot: { fontFamily: AppFonts.regular, fontSize: 12 },
  completion: { fontFamily: AppFonts.semibold, fontSize: 12, marginLeft: 'auto' },
  stateLoader: { paddingVertical: 64 },
  paneEmpty: { flex: 1, justifyContent: 'center' },
  state: { alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingVertical: 58 },
  stateTitle: { fontFamily: AppFonts.semibold, fontSize: 18, textAlign: 'center' },
  stateCopy: {
    fontFamily: AppFonts.regular,
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 380,
    textAlign: 'center',
  },
  primaryButton: {
    borderRadius: 16,
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 48,
    paddingHorizontal: 20,
  },
  primaryLabel: { fontFamily: AppFonts.semibold, fontSize: 14 },
  footer: { paddingVertical: 24 },
  continueButton: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    marginVertical: 20,
    minHeight: 48,
    paddingHorizontal: 20,
  },
  continueLabel: { fontFamily: AppFonts.semibold, fontSize: 14 },
  listEnd: { fontFamily: AppFonts.regular, fontSize: 12, paddingVertical: 24, textAlign: 'center' },
});

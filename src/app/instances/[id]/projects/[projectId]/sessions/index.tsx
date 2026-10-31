import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { NativeStackHeaderItemMenu } from 'expo-router/native-stack';

import { barButton } from '@/components/duo/column-header';
import { DuoArrangement } from '@/components/duo/arrangement';
import { ContentColumn } from '@/components/duo/content-column';
import { usePxiHeaderOptions } from '@/components/pxi-header-button';
import {
  SessionDetailView,
  SessionPane,
  type SessionQueueFilter,
} from '@/components/sessions/session-detail';
import { SessionRow } from '@/components/sessions/session-row';
import { InlineChoice, ProjectViewPicker } from '@/components/traces/project-list-header';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { StatusLabel } from '@/components/ui/status-label';
import { Type, useAppColors } from '@/constants/theme';
import { nativeHeaderTitle, useDuoLayout } from '@/features/duo/layout';
import { isSplitDetail, useSessionQueueOrder, useSplitDetail } from '@/features/duo/split-detail';
import { selectDetail } from '@/features/duo/split-routes';
import { classifySessionReview } from '@/features/session-review/classifier';
import type { SessionData } from '@/features/session-review/types';
import { usePhoenixProjects, usePhoenixTraceOpeners } from '@/hooks/use-phoenix-data';
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

const Filters = [
  { label: 'Needs review', value: 'needs-review' },
  { label: 'All', value: 'all' },
  { label: 'Reviewed', value: 'reviewed' },
] as const satisfies readonly { label: string; value: SessionQueueFilter }[];

/** Queue share of the regular-width split; the selected session takes the rest. */
const QUEUE_SPLIT_RATIO = 0.42;

/**
 * The project's Sessions list and human review queue. The review filter is a
 * bar menu and the queue's settings a bar item on iOS; elsewhere both stay in
 * the list.
 */
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
  const splitDetail = useSplitDetail();
  const publishQueueOrder = useSessionQueueOrder((state) => state.publish);
  const nativeBar = Platform.OS === 'ios';

  const [requestedFilter, setFilter] = useState<SessionQueueFilter>(
    Filters.find((option) => option.value === routeFilter)?.value ?? 'needs-review',
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

  // A session is titled by its first question, read from its earliest trace.
  const openingTraceIds = sessions.flatMap((session) => {
    const first = openingTraceId(session);

    return first ? [first] : [];
  });

  const openers = usePhoenixTraceOpeners(instance, projectId, openingTraceIds);

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

  // Without a configured queue the default view has nothing to show, so fall
  // back to every session until one is set up.
  const queueUnset = settings.requiredConfigNames.length === 0;
  const defaultFilter: SessionQueueFilter = queueUnset ? 'all' : 'needs-review';

  const filter: SessionQueueFilter =
    requestedFilter === 'needs-review' && queueUnset ? 'all' : requestedFilter;

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
      ? sessions.map((session) => ({
          classification: classifySessionReview(
            settings.requiredConfigNames,
            configs,
            annotationsBySessionId.get(session.session_id) ?? [],
          ),
          session,
        }))
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

  // A session page in the native detail column moves through this order after a review.
  const queueOrder = filteredRows.map((row) => row.session.id).join('\n');
  useEffect(() => {
    if (splitDetail.active)
      publishQueueOrder(projectId, queueOrder === '' ? [] : queueOrder.split('\n'));
  }, [projectId, publishQueueOrder, queueOrder, splitDetail.active]);

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

    selectDetail({
      pathname: '/instances/[id]/projects/[projectId]/sessions/[sessionId]',
      params: {
        id,
        projectId,
        sessionId,
        queueFilter: filter,
      },
    });
  };

  const openQueueSettings = () =>
    router.push({
      pathname: '/instances/[id]/projects/[projectId]/sessions/settings',
      params: { id, projectId },
    });

  const changeFilter = (next: SessionQueueFilter) => {
    if (next === filter) return;
    haptics.selection();
    setFilter(next);
  };

  // After "Submit & next" the reviewed row may leave the Needs review list once
  // annotations refetch, so the next row is chosen now, while it is still here.
  const selectNextSession = () => {
    const index = filteredRows.findIndex((row) => row.session.id === activeSessionId);
    setSelectedSessionId(filteredRows[index + 1]?.session.id ?? null);
  };

  const filterLabel = Filters.find((option) => option.value === filter)?.label ?? 'All';

  const filterMenu: NativeStackHeaderItemMenu = {
    type: 'menu',
    identifier: 'session-filter',
    label: 'Filter sessions',
    accessibilityLabel: `Filter sessions, ${filterLabel}`,
    icon: {
      type: 'sfSymbol',
      name:
        filter === defaultFilter
          ? 'line.3.horizontal.decrease.circle'
          : 'line.3.horizontal.decrease.circle.fill',
    },
    menu: {
      items: [
        {
          type: 'submenu',
          inline: true,
          label: 'Show',
          items: Filters.map((option) => ({
            type: 'action',
            label: option.label,
            description:
              option.value === 'needs-review' && queueUnset
                ? 'Set up the review queue first'
                : undefined,
            disabled: option.value === 'needs-review' && queueUnset,
            state: option.value === filter ? 'on' : 'off',
            onPress: () => changeFilter(option.value),
          })),
        },
      ],
    },
  };

  const queueButton = barButton({
    type: 'button',
    identifier: 'review-queue-settings',
    label: 'Review queue',
    icon: { type: 'sfSymbol', name: 'slider.horizontal.3' },
    onPress: openQueueSettings,
    visibilityPriority: 'standard',
  });

  const list = (
    <ContentColumn padding={0}>
      {(column) => (
        <FlatList
          contentContainerStyle={[styles.content, column, { paddingBottom: 24 + insets.bottom }]}
          contentInsetAdjustmentBehavior="automatic"
          data={filteredRows}
          extraData={activeSessionId}
          initialNumToRender={12}
          keyExtractor={({ session }) => session.id}
          ListHeaderComponent={
            <View>
              <ProjectViewPicker
                instanceId={id}
                projectId={projectId}
                title={project?.name}
                value="sessions"
              />
              {nativeBar ? null : (
                <InlineChoice
                  label="Show"
                  onChange={changeFilter}
                  options={Filters}
                  value={filter}
                />
              )}
              {queueConfigured && nativeBar ? null : (
                <QueueRow
                  configured={queueConfigured}
                  onPress={openQueueSettings}
                  requiredCount={settings.requiredConfigNames.length}
                  staleNames={staleNames}
                />
              )}
              <SectionHeader label={filterLabel} />
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
              scan={() => void sessionsQuery.fetchNextPage()}
            />
          }
          ListFooterComponent={
            sessionsQuery.isFetchingNextPage ? (
              <ActivityIndicator color={colors.textSecondary} style={styles.footer} />
            ) : filteredRows.length > 0 && sessionsQuery.hasNextPage ? (
              <ListRow
                accessibilityHint="Loads the next page of sessions"
                leading={
                  <SymbolView
                    name={{ android: 'expand_more', ios: 'arrow.down.circle', web: 'expand_more' }}
                    size={16}
                    tintColor={colors.textSecondary}
                  />
                }
                onPress={() => void sessionsQuery.fetchNextPage()}
                title="Scan older sessions"
              />
            ) : filteredRows.length > 0 ? (
              <Text style={[Type.subhead, styles.listEnd, { color: colors.textTertiary }]}>
                All loaded sessions shown
              </Text>
            ) : undefined
          }
          maxToRenderPerBatch={12}
          refreshControl={
            <RefreshControl
              colors={[colors.textSecondary]}
              onRefresh={refresh}
              progressBackgroundColor={colors.backgroundElement}
              refreshing={manualRefreshing}
              tintColor={colors.textSecondary}
            />
          }
          removeClippedSubviews={Platform.OS === 'android'}
          renderItem={({ item }) => (
            <SessionRow
              classification={item.classification}
              opener={openerOf(item.session, openers.data)}
              onPress={() => openSession(item.session.id)}
              selected={
                splitDetail.active
                  ? isSplitDetail(
                      splitDetail,
                      'instances/[id]/projects/[projectId]/sessions/[sessionId]',
                      'sessionId',
                      item.session.id,
                    )
                  : item.session.id === activeSessionId
              }
              session={item.session}
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
          headerBackTitle: instance.name,
          title: nativeHeaderTitle(systemBarEdge, project?.name ?? 'Project'),
          headerRight: nativeBar ? undefined : pxiHeader.headerRight,
          // PXI comes last, which puts it at the top of a vertical bar.
          unstable_headerRightItems: nativeBar
            ? (props) => [
                filterMenu,
                queueButton,
                ...(pxiHeader.unstable_headerRightItems?.(props) ?? []),
              ]
            : undefined,
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
                <EmptyState
                  message="Choose a session from the queue to read its conversation and review it here."
                  symbol={{ android: 'forum', ios: 'bubble.left.and.bubble.right', web: 'forum' }}
                  title="Select a session"
                />
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

/**
 * The review queue's state as one row: a prompt to set it up, a warning when
 * its annotations were removed, or (where there is no bar item) a way in.
 */
function QueueRow({
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
  const stale = staleNames.length > 0;

  const title = configured
    ? 'Review queue'
    : stale
      ? 'Review queue needs attention'
      : 'Set up review queue';

  const subtitle = configured
    ? `${requiredCount} required annotation${requiredCount === 1 ? '' : 's'}`
    : stale
      ? `${staleNames.join(', ')} ${staleNames.length === 1 ? 'was' : 'were'} removed from this project.`
      : 'Choose the annotations that mark a session reviewed.';

  return (
    <ListRow
      accessibilityHint="Opens review queue settings"
      leading={<StatusLabel tone={configured ? 'ok' : stale ? 'error' : 'pending'} />}
      onPress={onPress}
      subtitle={subtitle}
      title={title}
    />
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
  if (dataError)
    return (
      <EmptyState
        action={{ label: 'Try again', onPress: retry }}
        message={dataError.message}
        symbol={{ android: 'error', ios: 'exclamationmark.triangle', web: 'error' }}
        title="Couldn’t load sessions"
      />
    );

  if (loading) return <EmptyState loading title="Loading sessions" />;

  if (!queueConfigured && filter === 'needs-review')
    return (
      <EmptyState
        message="Set up required annotations before using Needs review. Every session stays available under All."
        title="Queue not configured"
      />
    );

  if (!hasSessions)
    return (
      <EmptyState
        message="Sessions appear when this project receives traces with session IDs."
        symbol={{ android: 'forum', ios: 'bubble.left.and.bubble.right', web: 'forum' }}
        title="No sessions yet"
      />
    );

  if (hasNextPage)
    return (
      <EmptyState
        action={{ label: 'Scan older sessions', onPress: scan }}
        message="The newest sessions are checked. Older sessions haven’t been scanned yet."
        title={filter === 'reviewed' ? 'No reviewed sessions yet' : 'Queue is clear so far'}
      />
    );

  return (
    <EmptyState
      message={
        filter === 'reviewed'
          ? 'No loaded session has all required human annotations.'
          : 'Every available session has all required human annotations.'
      }
      symbol={{ android: 'task_alt', ios: 'checkmark.circle', web: 'task_alt' }}
      title={filter === 'reviewed' ? 'No reviewed sessions' : 'Queue is clear'}
    />
  );
}

function UnavailableState({ message, title }: { message: string; title: string }) {
  const colors = useAppColors();

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Sessions' }} />
      <EmptyState
        action={{
          label: 'Go back',
          onPress: () => {
            if (router.canGoBack()) router.back();
            else router.replace('/');
          },
        }}
        message={message}
        title={title}
      />
    </View>
  );
}

function openingTraceId(session: SessionData) {
  return [...session.traces].sort((a, b) => a.start_time.localeCompare(b.start_time))[0]?.trace_id;
}

function openerOf(session: SessionData, openers: Record<string, string> | undefined) {
  const first = openingTraceId(session);

  return openers && first ? (openers[first] ?? null) : null;
}

function deduplicateSessions(sessions: SessionData[]) {
  return [...new Map(sessions.map((session) => [session.id, session])).values()];
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { alignSelf: 'center', flexGrow: 1, width: '100%' },
  footer: { paddingVertical: 24 },
  listEnd: { paddingVertical: 24, textAlign: 'center' },
});

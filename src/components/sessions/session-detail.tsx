import * as Clipboard from 'expo-clipboard';
import { router, Stack } from 'expo-router';
import type { NativeStackHeaderItem, NativeStackHeaderItemProps } from 'expo-router/native-stack';
import { type ReactElement, type ReactNode, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  type RefreshControlProps,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ModelPicker } from '@/components/chat/model-picker';
import { DuoArrangement, useArrangementPane } from '@/components/duo/arrangement';
import { barButton, barMenu } from '@/components/duo/column-header';
import { openPxiAction } from '@/components/pxi-header-button';
import { EmptyState } from '@/components/ui/empty-state';
import { useAppColors } from '@/constants/theme';
import { useContentColumnStyle, useDuoLayout } from '@/features/duo/layout';
import type { PxiActionParams } from '@/features/pxi/actions';
import { createPxiInvestigationKey, usePxiInvestigationStore } from '@/features/pxi/investigation';
import { isSameModel, usePxiModelCatalog } from '@/features/pxi/model-catalog';
import type { ModelSelection } from '@/features/pxi/types';
import { classifySessionReview } from '@/features/session-review/classifier';
import { usePhoenixProjects, usePhoenixViewer } from '@/hooks/use-phoenix-data';
import {
  usePhoenixProjectAnnotationConfigs,
  usePhoenixSession,
  usePhoenixSessionAnnotations,
  usePhoenixSessionPxiNotes,
  usePhoenixSessionTurns,
} from '@/hooks/use-phoenix-sessions';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';
import {
  getSessionReviewQueueSettings,
  useSessionReviewSettingsStore,
} from '@/store/session-review-settings';

import { ReviewTools } from './review-form';
import { ConversationList, type SessionContentActions } from './session-detail-conversation';
import type { LoadedSession, SessionQueueFilter } from './session-detail-types';

export type { SessionQueueFilter } from './session-detail-types';

export type SessionDetailViewProps = {
  instanceId: string;
  projectId: string;
  /** Phoenix session node id, as listed by the project sessions route. */
  sessionId: string;
  /**
   * Rendered inside another screen's pane. Keeps the single scrolling layout
   * on every width; the host owns navigation and the surrounding split.
   */
  embedded?: boolean;
  /** Queue view to return to after "Submit & back to queue". */
  queueFilter?: SessionQueueFilter;
  /**
   * Replaces the back-to-queue navigation after a successful review. A host
   * that shows this view beside the queue advances the selection instead of
   * popping its own route.
   */
  onReviewed?: () => void;
  /**
   * Header items of the hosting route, placed after the session's own so PXI
   * sits at the top of iPhone Duo's vertical bar. When set, the session's
   * actions (More, Add to dataset, Investigate) become native bar items
   * instead of buttons in the content.
   */
  barItems?: (props: NativeStackHeaderItemProps) => NativeStackHeaderItem[];
};

/** Narrowest view that splits the conversation from the review tools. */
const SPLIT_MINIMUM_WIDTH = 760;

/** Conversation share of the regular-width split; review tools take the rest. */
const SPLIT_CONVERSATION_RATIO = 0.58;

/**
 * A session for human review: the conversation as a flat transcript, then
 * PXI's notes and the review form. A full-width iPad splits the two into
 * columns divided by a hairline.
 */
export function SessionDetailView({
  barItems,
  embedded = false,
  instanceId: id,
  onReviewed,
  projectId,
  queueFilter,
  sessionId,
}: SessionDetailViewProps) {
  const colors = useAppColors();
  const { isRegularWidth, width } = useDuoLayout();
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
    (state) => state.anonymousReviewerIds[id],
  );

  const ensureAnonymousReviewerId = useSessionReviewSettingsStore(
    (state) => state.ensureAnonymousReviewerId,
  );

  const settings = getSessionReviewQueueSettings(queues, id, projectId);

  const configs = settings.requiredConfigNames.flatMap((name) => {
    const config = configsQuery.data?.find((candidate) => candidate.name === name);

    return config ? [config] : [];
  });

  const staleNames = settings.requiredConfigNames.filter(
    (name) => !configsQuery.data?.some((config) => config.name === name),
  );

  const annotations = usePhoenixSessionAnnotations(
    instance,
    projectId,
    session.data ? [[session.data.session_id]] : [],
    // Include the reserved note annotation so the form can tell whether this
    // installation already saved a note; the classifier ignores notes.
    settings.requiredConfigNames.length > 0 ? [...settings.requiredConfigNames, 'note'] : [],
  );

  const annotationsSuccess = settings.requiredConfigNames.length === 0 || annotations.isSuccess;

  const classification = classifySessionReview(
    settings.requiredConfigNames,
    configs,
    annotations.data ?? [],
  );

  const reviewStatus =
    reviewSettingsHydrated && configsQuery.isSuccess && annotationsSuccess
      ? classification.status
      : undefined;

  const pxiNotes = usePhoenixSessionPxiNotes(
    instance,
    projectId,
    session.data?.session_id,
    turns.data,
  );

  const catalog = usePxiModelCatalog(instance);
  const preferredPxiModel = useInstanceStore((state) => state.pxiModels[id]);
  const setPxiModel = useInstanceStore((state) => state.setPxiModel);
  const [modelPickerVisible, setModelPickerVisible] = useState(false);

  const investigationKey = session.data
    ? createPxiInvestigationKey('investigate-session', id, projectId, session.data.session_id)
    : null;

  const investigation = usePxiInvestigationStore((state) =>
    investigationKey ? state.runs[investigationKey] : undefined,
  );

  const isRefreshing =
    session.isRefetching ||
    turns.isRefetching ||
    configsQuery.isRefetching ||
    annotations.isRefetching ||
    pxiNotes.isRefetching ||
    viewer.isRefetching;

  useEffect(() => {
    if (reviewSettingsHydrated && !anonymousReviewerId) ensureAnonymousReviewerId(id);
  }, [anonymousReviewerId, ensureAnonymousReviewerId, id, reviewSettingsHydrated]);

  if (!instance)
    return (
      <UnavailableState
        message="This Phoenix connection is no longer on this device."
        title="Instance not found"
      />
    );

  if (projects.isSuccess && !project)
    return (
      <UnavailableState message="This project is no longer available." title="Project not found" />
    );

  const openInvestigationSheet = (model?: ModelSelection) => {
    if (!session.data) return;

    const params: PxiActionParams = {
      action: 'investigate-session',
      id,
      projectId,
      sessionId: session.data.session_id,
      sessionNodeId: session.data.id,
    };

    if (model) {
      params.modelName = model.modelName;
      params.modelProviderType = model.providerType;

      if (model.providerType === 'builtin') params.modelProvider = model.provider;
      else params.modelProviderId = model.providerId;
    }

    openPxiAction(params);
  };

  const investigate = () => {
    // An existing run (live or finished while the sheet was closed) reopens the
    // transcript; the model choice only applies to a brand-new investigation.
    if (investigation || !catalog.data || catalog.data.options.length === 0) {
      openInvestigationSheet();

      return;
    }

    setModelPickerVisible(true);
  };

  const addToDataset = () =>
    router.push({
      pathname: '/instances/[id]/projects/[projectId]/sessions/add-to-dataset',
      params: { id, projectId, sessionId },
    });

  // Copies Phoenix's session ID, which people search for, not the node id.
  const copySessionId = () => {
    if (!session.data) return;
    void Clipboard.setStringAsync(session.data.session_id).then(haptics.success);
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

  const refreshControl = (
    <RefreshControl
      colors={[colors.textSecondary]}
      onRefresh={() => void refresh()}
      progressBackgroundColor={colors.backgroundElement}
      refreshing={isRefreshing}
      tintColor={colors.textSecondary}
    />
  );

  // Split the conversation from the review tools only when this view owns a
  // wide screen (a full iPad); a host pane or a split column, such as the open
  // iPhone Duo's detail column, keeps one scroller.
  const split = isRegularWidth && width >= SPLIT_MINIMUM_WIDTH && !embedded;

  const contentActions: SessionContentActions | null = barItems
    ? null
    : {
        investigationStatus: investigation?.status ?? null,
        onAddToDataset: addToDataset,
        onCopySessionId: copySessionId,
        onInvestigate: investigate,
      };

  const renderBody = (loaded: LoadedSession) => {
    const reviewTools = (
      <ReviewTools
        allAnnotations={annotations.data ?? []}
        annotationsError={annotations.error}
        annotationsSuccess={annotationsSuccess}
        anonymousReviewerId={anonymousReviewerId}
        classification={classification}
        configs={configs}
        configsError={configsQuery.error}
        configsSuccess={configsQuery.isSuccess}
        instanceId={id}
        onReviewed={onReviewed}
        projectId={projectId}
        pxiNotes={pxiNotes}
        queueFilter={queueFilter}
        retry={refresh}
        session={loaded}
        staleNames={staleNames}
        turns={turns.data ?? []}
        viewer={viewer}
      />
    );

    const conversation = (
      <ConversationList
        actions={contentActions}
        footer={split ? undefined : reviewTools}
        instanceId={id}
        projectId={projectId}
        refreshControl={refreshControl}
        reviewStatus={reviewStatus}
        session={loaded}
        turns={turns}
      />
    );

    if (!split) return conversation;

    return (
      <DuoArrangement
        preferredAxis="horizontal"
        primary={conversation}
        ratio={SPLIT_CONVERSATION_RATIO}
        secondary={
          <SessionPane>
            <ReviewPane refreshControl={refreshControl}>{reviewTools}</ReviewPane>
          </SessionPane>
        }
      />
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      {barItems ? (
        <Stack.Screen
          options={{
            // UIKit stacks trailing items from the far end of the bar, so the
            // last item sits at the top of iPhone Duo's vertical bar: PXI, then
            // Investigate, Add to dataset, and More lowest.
            unstable_headerRightItems: (props) => [
              barMenu({
                type: 'menu',
                identifier: 'session-more',
                visibilityPriority: 'low',
                label: 'More',
                icon: { type: 'sfSymbol', name: 'ellipsis.circle' },
                menu: {
                  items: [
                    {
                      type: 'action',
                      label: 'Copy session ID',
                      icon: { type: 'sfSymbol', name: 'doc.on.doc' },
                      disabled: !session.data,
                      onPress: copySessionId,
                    },
                  ],
                },
              }),
              barButton({
                type: 'button',
                label: 'Add to dataset',
                icon: { type: 'sfSymbol', name: 'tray.and.arrow.down' },
                onPress: addToDataset,
              }),
              barButton({
                type: 'button',
                label: investigation
                  ? investigation.status === 'running'
                    ? 'PXI is investigating'
                    : 'View PXI investigation'
                  : 'Investigate with PXI',
                icon: { type: 'sfSymbol', name: 'text.magnifyingglass' },
                onPress: investigate,
                visibilityPriority: 'high',
              }),
              ...barItems(props),
            ],
          }}
        />
      ) : null}
      {session.isPending ? (
        <EmptyState loading title="Loading session" />
      ) : session.isError ? (
        <EmptyState
          action={{ label: 'Try again', onPress: () => void session.refetch() }}
          message={session.error.message}
          symbol={{ android: 'warning', ios: 'exclamationmark.triangle', web: 'warning' }}
          title="Couldn’t load this session"
        />
      ) : !session.data ? (
        <EmptyState
          message="Phoenix returned no session data."
          symbol={{ android: 'search_off', ios: 'questionmark.circle', web: 'search_off' }}
          title="Session not found"
        />
      ) : (
        renderBody(session.data)
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
              (option) => preferredPxiModel && isSameModel(option.selection, preferredPxiModel),
            )?.selection ??
            catalog.data.defaultSelection ??
            catalog.data.options[0].selection
          }
          visible={modelPickerVisible}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

/**
 * Fills a `DuoArrangement` pane and draws a hairline toward its neighbour while
 * the device is flat; a fold supplies its own gutter.
 */
export function SessionPane({ children }: { children: ReactNode }) {
  const colors = useAppColors();
  const pane = useArrangementPane();
  const divided = pane?.role === 'secondary' && !pane.isFolded;

  return (
    <View
      style={[
        styles.pane,
        divided && pane.axis === 'horizontal' ? styles.paneDividerLeading : null,
        divided && pane.axis === 'vertical' ? styles.paneDividerTop : null,
        divided ? { borderColor: colors.separator } : null,
      ]}
    >
      {children}
    </View>
  );
}

function ReviewPane({
  children,
  refreshControl,
}: {
  children: ReactNode;
  refreshControl: ReactElement<RefreshControlProps>;
}) {
  const insets = useSafeAreaInsets();
  const column = useContentColumnStyle(0);

  return (
    <ScrollView
      contentContainerStyle={[styles.content, column, { paddingBottom: 30 + insets.bottom }]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  );
}

function UnavailableState({ message, title }: { message: string; title: string }) {
  const colors = useAppColors();

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <EmptyState
        message={message}
        symbol={{ android: 'search_off', ios: 'questionmark.circle', web: 'search_off' }}
        title={title}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pane: { flex: 1 },
  paneDividerLeading: { borderLeftWidth: StyleSheet.hairlineWidth },
  paneDividerTop: { borderTopWidth: StyleSheet.hairlineWidth },
  content: { alignSelf: 'center', width: '100%' },
});

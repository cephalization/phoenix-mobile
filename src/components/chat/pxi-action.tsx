import { useChat } from '@ai-sdk/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatMessage } from '@/components/chat/chat-message';
import { MotionPressable } from '@/components/motion-pressable';
import { PxiGlyph } from '@/components/pxi-glyph';
import { AppFonts, useAppColors } from '@/constants/theme';
import { useContentColumnStyle } from '@/features/duo/layout';
import {
  resolvePxiAction,
  parseServerVersion,
  type PxiActionRouteParams,
  type ResolvedPxiAction,
} from '@/features/pxi/actions';
import { formatPxiError } from '@/features/pxi/client';
import {
  createPxiInvestigationKey,
  usePxiInvestigationStore,
  type PxiInvestigation,
} from '@/features/pxi/investigation';
import { isSameModel, usePxiModelCatalog } from '@/features/pxi/model-catalog';
import type { BuiltInProvider, ModelSelection, PxiMessage } from '@/features/pxi/types';
import { compareVersions } from '@/features/session-review/api';
import { usePhoenixVersion, usePhoenixViewer } from '@/hooks/use-phoenix-data';
import { phoenixSessionQueryKeys } from '@/hooks/use-phoenix-sessions';
import { useInstanceStore } from '@/store/instances';
import type { PhoenixInstance } from '@/types/instance';

/**
 * A contextual PXI run (today: investigate a session) with its brief and
 * streamed transcript. The action route presents it as a form sheet: a bottom
 * sheet on compact width, a full-height sheet beside the vertical bar on
 * regular width. The native header carries the title, the brief card names the
 * instance and model, and the sheet dismisses by swipe, like every other task
 * sheet.
 */
export function PxiActionView({
  onClose,
  params,
}: {
  onClose: () => void;
  params: PxiActionRouteParams;
}) {
  const queryClient = useQueryClient();

  const instance = useInstanceStore((state) =>
    state.instances.find((item) => item.id === params.id),
  );

  const preferredModel = useInstanceStore((state) =>
    params.id ? state.pxiModels[params.id] : undefined,
  );

  const action = resolvePxiAction(params);

  const runKey = action
    ? createPxiInvestigationKey(
        action.key,
        params.id,
        params.projectId ?? '',
        params.sessionId ?? '',
      )
    : null;

  const run = usePxiInvestigationStore((state) => (runKey ? state.runs[runKey] : undefined));
  const startRun = usePxiInvestigationStore((state) => state.startRun);
  const clearRun = usePxiInvestigationStore((state) => state.clearRun);
  const hasRun = Boolean(run);
  const version = usePhoenixVersion(instance);
  const viewer = usePhoenixViewer(instance);
  const catalog = usePxiModelCatalog(instance);

  const paramModel = parseModelParams(params);

  const preferredOption = catalog.data?.options.find(
    (option) => preferredModel && isSameModel(option.selection, preferredModel),
  );

  const selectedModel =
    paramModel ?? preferredOption?.selection ?? catalog.data?.defaultSelection ?? null;

  const serverVersion = parseServerVersion(version.data);

  const versionSupported =
    serverVersion && action ? compareVersions(serverVersion, action.minimumVersion) >= 0 : null;

  const readOnly =
    viewer.data != null && viewer.data.auth_method !== 'ANONYMOUS' && viewer.data.role === 'VIEWER';

  const readyToStart = Boolean(
    !hasRun &&
    instance &&
    action &&
    runKey &&
    selectedModel &&
    versionSupported &&
    viewer.isSuccess &&
    !readOnly,
  );

  useEffect(() => {
    if (!readyToStart || !instance || !action || !runKey || !selectedModel) return;
    const sessionContext = action.contexts.find((context) => context.type === 'session');
    startRun({
      action,
      instance,
      key: runKey,
      model: selectedModel,
      onSettled: () => {
        if (!sessionContext) return;
        void queryClient.invalidateQueries({
          queryKey: [
            ...phoenixSessionQueryKeys.project(instance.id, sessionContext.projectNodeId),
            'pxi-notes',
          ],
        });
      },
    });
  }, [action, instance, queryClient, readyToStart, runKey, selectedModel, startRun]);

  // A dismissed sheet keeps a live run streaming; settled runs are viewing-only
  // transcripts, so leaving the sheet retires them and the next launch is fresh.
  useEffect(
    () => () => {
      if (!runKey) return;
      const current = usePxiInvestigationStore.getState().runs[runKey];

      if (current && current.status !== 'running') clearRun(runKey);
    },
    [clearRun, runKey],
  );

  const modelLabel = run
    ? (catalog.data?.options.find((option) => isSameModel(option.selection, run.model))?.label ??
      run.model.modelName)
    : null;

  // The sheet's native header is translucent and the content runs under it,
  // so the screen's root is always a scroll view with automatic insets, like
  // the other task sheets; a scroll view nested in a plain view gets no inset
  // and no frame inside a form sheet.
  return run && instance && action ? (
    <ActionRun
      action={action}
      instance={instance}
      modelLabel={modelLabel ?? run.model.modelName}
      onClose={onClose}
      run={run}
      runKey={runKey!}
    />
  ) : !instance ? (
    <SheetState
      title="Instance not found"
      copy="This Phoenix connection is no longer on this device."
    />
  ) : !action ? (
    <SheetState
      title="Unknown PXI action"
      copy="This contextual action is missing or has incomplete parameters."
    />
  ) : version.isError ? (
    <SheetState
      title="Couldn’t check this server"
      copy={version.error.message}
      action="Try again"
      onPress={() => version.refetch()}
    />
  ) : viewer.isError ? (
    <SheetState
      title="Couldn’t check your Phoenix access"
      copy={viewer.error.message}
      action="Try again"
      onPress={() => viewer.refetch()}
    />
  ) : versionSupported === false ? (
    <SheetState
      title="Phoenix upgrade required"
      copy={`${action.capability} requires Phoenix ${action.minimumVersion.join('.')} or newer; this server is ${version.data}.`}
    />
  ) : viewer.isSuccess && readOnly ? (
    <SheetState
      title="Read-only access"
      copy="Your Phoenix Viewer role can browse this instance, but PXI cannot save notes on its behalf."
    />
  ) : !selectedModel && catalog.isError ? (
    <SheetState
      title="PXI isn’t ready"
      copy={formatPxiError(catalog.error)}
      action="Try again"
      onPress={() => catalog.refetch()}
    />
  ) : !selectedModel && catalog.isSuccess ? (
    <SheetState
      title="No recommended model is configured"
      copy="Configure a Phoenix-recommended agent model, then try again."
      action="Check again"
      onPress={() => catalog.refetch()}
    />
  ) : (
    <SheetState loading copy="Preparing PXI…" />
  );
}

function parseModelParams(params: {
  modelName?: string;
  modelProvider?: BuiltInProvider;
  modelProviderId?: string;
  modelProviderType?: string;
}): ModelSelection | null {
  if (!params.modelName) return null;

  if (params.modelProviderType === 'builtin' && params.modelProvider) {
    return {
      modelName: params.modelName,
      provider: params.modelProvider,
      providerType: 'builtin',
    };
  }

  if (params.modelProviderType === 'custom' && params.modelProviderId) {
    return {
      modelName: params.modelName,
      providerId: params.modelProviderId,
      providerType: 'custom',
    };
  }

  return null;
}

function ActionRun({
  action,
  instance,
  modelLabel,
  onClose,
  run,
  runKey,
}: {
  action: ResolvedPxiAction;
  instance: PhoenixInstance;
  modelLabel: string;
  onClose: () => void;
  run: PxiInvestigation;
  runKey: string;
}) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const column = useContentColumnStyle(18);
  const clearRun = usePxiInvestigationStore((state) => state.clearRun);
  const listRef = useRef<FlatList<PxiMessage>>(null);
  const followLiveEdge = useRef(true);

  const { error, messages, status, stop } = useChat<PxiMessage>({
    chat: run.chat,
    experimental_throttle: 50,
  });

  const isStreaming = status === 'submitted' || status === 'streaming';
  const assistantMessages = messages.filter((message) => message.role === 'assistant');

  const isAwaitingAssistant =
    isStreaming && (assistantMessages.length === 0 || messages.at(-1)?.role === 'user');

  const finished = run.status === 'done';
  const failed = run.status === 'error' || run.status === 'stopped';

  // A failed turn cannot be regenerated once the server has persisted its
  // prompt, so retrying clears this run and lets the launch effect start a
  // fresh one on a fresh ephemeral session.
  const retry = () => {
    clearRun(runKey);
  };

  return (
    <FlatList
      contentContainerStyle={[styles.transcript, column, { paddingBottom: 16 + insets.bottom }]}
      contentInsetAdjustmentBehavior="automatic"
      style={[styles.run, { backgroundColor: colors.background }]}
      data={assistantMessages}
      keyExtractor={(message) => message.id}
      ListHeaderComponent={
        <View
          style={[
            styles.briefCard,
            { backgroundColor: colors.backgroundSelected, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.briefCopy, { color: colors.textSecondary }]}>{action.brief}</Text>
          <Text style={[styles.briefMeta, { color: colors.textSecondary }]}>
            {instance.name} · {modelLabel}
          </Text>
        </View>
      }
      ListFooterComponent={
        <>
          {isAwaitingAssistant ? (
            <View
              accessibilityLabel="PXI is thinking"
              accessibilityRole="progressbar"
              style={styles.pending}
            >
              <ActivityIndicator color={colors.brand} size="small" />
              <Text style={[styles.pendingLabel, { color: colors.textSecondary }]}>Thinking…</Text>
            </View>
          ) : null}
          {finished ? (
            <Text style={[styles.doneCopy, { color: colors.success }]}>
              PXI finished. Its notes now appear on the session screen below the conversation.
            </Text>
          ) : null}
          {failed && !isStreaming ? (
            <View
              style={[
                styles.errorBar,
                { backgroundColor: colors.backgroundSelected, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.errorText, { color: colors.text }]}>
                {run.status === 'stopped'
                  ? 'The investigation stopped before it finished.'
                  : formatPxiError(
                      error ?? new Error('PXI could not complete this investigation.'),
                    )}
              </Text>
              <MotionPressable accessibilityRole="button" haptic="selection" onPress={retry}>
                <Text style={[styles.retryText, { color: colors.brand }]}>Retry</Text>
              </MotionPressable>
            </View>
          ) : null}
          <View style={styles.footer}>
            {isStreaming ? (
              <MotionPressable
                accessibilityRole="button"
                haptic="selection"
                onPress={() => void stop()}
                style={[styles.footerButton, { borderColor: colors.border, borderWidth: 1 }]}
              >
                <Text style={[styles.footerButtonLabel, { color: colors.text }]}>Stop</Text>
              </MotionPressable>
            ) : (
              <MotionPressable
                accessibilityRole="button"
                onPress={onClose}
                style={[styles.footerButton, { backgroundColor: colors.accent }]}
              >
                <Text style={[styles.footerButtonLabel, { color: colors.accentForeground }]}>
                  {finished ? 'Done' : 'Close'}
                </Text>
              </MotionPressable>
            )}
            <Text style={[styles.disclaimer, { color: colors.textSecondary }]}>
              {isStreaming
                ? 'You can close this — PXI keeps investigating and the notes will appear when it finishes.'
                : 'PXI can make mistakes. Verify its notes against the conversation.'}
            </Text>
          </View>
        </>
      }
      onContentSizeChange={() => {
        if (followLiveEdge.current) {
          requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
        }
      }}
      onScrollBeginDrag={() => {
        followLiveEdge.current = false;
      }}
      ref={listRef}
      renderItem={({ item }) => (
        <ChatMessage
          instanceBaseUrl={instance.baseUrl}
          message={item}
          onInteraction={() => {
            followLiveEdge.current = false;
          }}
          pending={isStreaming && item.id === messages.at(-1)?.id}
        />
      )}
    />
  );
}

function SheetState({
  action,
  copy,
  loading,
  onPress,
  title,
}: {
  action?: string;
  copy: string;
  loading?: boolean;
  onPress?: () => void;
  title?: string;
}) {
  const colors = useAppColors();

  return (
    <ScrollView
      contentContainerStyle={styles.fill}
      contentInsetAdjustmentBehavior="automatic"
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View style={styles.center}>
        {loading ? (
          <ActivityIndicator color={colors.brand} />
        ) : (
          <PxiGlyph color={colors.brand} size={28} />
        )}
        {title ? <Text style={[styles.stateTitle, { color: colors.text }]}>{title}</Text> : null}
        <Text style={[styles.stateCopy, { color: colors.textSecondary }]}>{copy}</Text>
        {action && onPress ? (
          <MotionPressable
            accessibilityRole="button"
            onPress={onPress}
            style={[styles.stateButton, { backgroundColor: colors.accent }]}
          >
            <Text style={[styles.stateButtonLabel, { color: colors.accentForeground }]}>
              {action}
            </Text>
          </MotionPressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  run: { flex: 1 },
  transcript: { alignSelf: 'center', gap: 24, paddingTop: 18, width: '100%' },
  briefCard: { borderRadius: 18, borderWidth: 1, gap: 7, marginBottom: 4, padding: 15 },
  briefCopy: { fontFamily: AppFonts.regular, fontSize: 13, lineHeight: 19 },
  briefMeta: { fontFamily: AppFonts.medium, fontSize: 11 },
  pending: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 24 },
  pendingLabel: { fontFamily: AppFonts.regular, fontSize: 12, fontStyle: 'italic' },
  doneCopy: { fontFamily: AppFonts.medium, fontSize: 13, lineHeight: 19 },
  errorBar: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 11,
  },
  errorText: { flex: 1, fontFamily: AppFonts.regular, fontSize: 12, lineHeight: 17 },
  retryText: { fontFamily: AppFonts.semibold, fontSize: 13 },
  footer: { gap: 7, paddingTop: 4 },
  footerButton: { alignItems: 'center', borderRadius: 16, justifyContent: 'center', minHeight: 50 },
  footerButtonLabel: { fontFamily: AppFonts.semibold, fontSize: 15 },
  disclaimer: { fontFamily: AppFonts.regular, fontSize: 10, textAlign: 'center' },
  fill: { flexGrow: 1 },
  center: { alignItems: 'center', flex: 1, gap: 10, justifyContent: 'center', padding: 28 },
  stateTitle: { fontFamily: AppFonts.semibold, fontSize: 20, textAlign: 'center' },
  stateCopy: {
    fontFamily: AppFonts.regular,
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 340,
    textAlign: 'center',
  },
  stateButton: {
    borderRadius: 14,
    justifyContent: 'center',
    marginTop: 4,
    minHeight: 48,
    paddingHorizontal: 17,
  },
  stateButtonLabel: { fontFamily: AppFonts.semibold, fontSize: 14 },
});

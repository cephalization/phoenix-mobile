import { useChat } from '@ai-sdk/react';
import { useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatMessage } from '@/components/chat/chat-message';
import { barButton } from '@/components/duo/column-header';
import { MotionPressable } from '@/components/motion-pressable';
import { PxiGlyph } from '@/components/pxi-glyph';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusLabel } from '@/components/ui/status-label';
import { AppFonts, Type, useAppColors } from '@/constants/theme';
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
 * regular width. The native header carries the title and Done (and Stop while
 * PXI runs) on iOS; the brief names the instance and model above the
 * transcript, and the sheet also dismisses by swipe, like every other task sheet.
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
      onClose={onClose}
      title="Instance not found"
      copy="This Phoenix connection is no longer on this device."
    />
  ) : !action ? (
    <SheetState
      onClose={onClose}
      title="Unknown PXI action"
      copy="This contextual action is missing or has incomplete parameters."
    />
  ) : version.isError ? (
    <SheetState
      onClose={onClose}
      title="Couldn’t check this server"
      copy={version.error.message}
      action="Try again"
      onPress={() => version.refetch()}
    />
  ) : viewer.isError ? (
    <SheetState
      onClose={onClose}
      title="Couldn’t check your Phoenix access"
      copy={viewer.error.message}
      action="Try again"
      onPress={() => viewer.refetch()}
    />
  ) : versionSupported === false ? (
    <SheetState
      onClose={onClose}
      title="Phoenix upgrade required"
      copy={`${action.capability} requires Phoenix ${action.minimumVersion.join('.')} or newer; this server is ${version.data}.`}
    />
  ) : viewer.isSuccess && readOnly ? (
    <SheetState
      onClose={onClose}
      title="Read-only access"
      copy="Your Phoenix Viewer role can browse this instance, but PXI cannot save notes on its behalf."
    />
  ) : !selectedModel && catalog.isError ? (
    <SheetState
      onClose={onClose}
      title="PXI isn’t ready"
      copy={formatPxiError(catalog.error)}
      action="Try again"
      onPress={() => catalog.refetch()}
    />
  ) : !selectedModel && catalog.isSuccess ? (
    <SheetState
      onClose={onClose}
      title="No recommended model is configured"
      copy="Configure a Phoenix-recommended agent model, then try again."
      action="Check again"
      onPress={() => catalog.refetch()}
    />
  ) : (
    <SheetState loading copy="Preparing PXI…" onClose={onClose} />
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
  const column = useContentColumnStyle(20);
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
      contentContainerStyle={[styles.transcript, column, { paddingBottom: 20 + insets.bottom }]}
      contentInsetAdjustmentBehavior="automatic"
      style={[styles.run, { backgroundColor: colors.background }]}
      data={assistantMessages}
      keyExtractor={(message) => message.id}
      ListHeaderComponent={
        <View style={[styles.brief, { borderBottomColor: colors.separator }]}>
          <SheetBar onClose={onClose} onStop={isStreaming ? () => void stop() : undefined} />
          <Text style={[Type.subhead, { color: colors.textSecondary }]}>{action.brief}</Text>
          <Text numberOfLines={1} style={[Type.mono, { color: colors.textTertiary }]}>
            {instance.name} · {modelLabel}
          </Text>
        </View>
      }
      ListFooterComponent={
        <View style={styles.footer}>
          {isAwaitingAssistant ? (
            <View
              accessibilityLabel="PXI is thinking"
              accessibilityRole="progressbar"
              style={styles.pending}
            >
              <ActivityIndicator
                color={colors.textTertiary}
                size="small"
                style={styles.pendingSpinner}
              />
              <Text style={[Type.subhead, { color: colors.textSecondary }]}>Thinking…</Text>
            </View>
          ) : null}
          {finished ? (
            <View style={styles.outcome}>
              <StatusLabel label="Finished" tone="ok" />
              <Text style={[Type.subhead, { color: colors.textSecondary }]}>
                PXI’s notes now appear on the session, below the conversation.
              </Text>
            </View>
          ) : null}
          {failed && !isStreaming ? (
            <View accessibilityLiveRegion="polite" style={styles.notice}>
              <SymbolView
                name={{ ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' }}
                size={13}
                tintColor={run.status === 'stopped' ? colors.textSecondary : colors.danger}
              />
              <Text style={[Type.subhead, styles.noticeText, { color: colors.textSecondary }]}>
                {run.status === 'stopped'
                  ? 'The investigation stopped before it finished.'
                  : formatPxiError(
                      error ?? new Error('PXI could not complete this investigation.'),
                    )}
              </Text>
              <MotionPressable
                accessibilityRole="button"
                haptic="selection"
                hitSlop={12}
                onPress={retry}
              >
                <Text style={[styles.noticeAction, { color: colors.text }]}>Retry</Text>
              </MotionPressable>
            </View>
          ) : null}
          {Platform.OS === 'ios' ? null : isStreaming ? (
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
                Done
              </Text>
            </MotionPressable>
          )}
          <Text style={[Type.label, styles.disclaimer, { color: colors.textTertiary }]}>
            {isStreaming
              ? 'You can close this. PXI keeps investigating, and its notes appear when it finishes.'
              : 'PXI can make mistakes. Check its notes against the conversation.'}
          </Text>
        </View>
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

/**
 * The sheet's bar items on iOS: Done at the far end, so it tops iPhone Duo's
 * vertical bar, and Stop beside it while PXI runs. Closing never stops a run.
 * Other platforms show the same actions in the content.
 */
function SheetBar({ onClose, onStop }: { onClose: () => void; onStop?: () => void }) {
  if (Platform.OS !== 'ios') return null;

  const done = barButton({
    type: 'button',
    label: 'Done',
    icon: { type: 'sfSymbol', name: 'checkmark' },
    onPress: onClose,
    variant: 'done',
    visibilityPriority: 'high',
  });

  const items = onStop
    ? [
        barButton({
          type: 'button',
          label: 'Stop',
          icon: { type: 'sfSymbol', name: 'stop.circle' },
          onPress: onStop,
          visibilityPriority: 'high',
        }),
        done,
      ]
    : [done];

  return <Stack.Screen options={{ unstable_headerRightItems: () => items }} />;
}

function SheetState({
  action,
  copy,
  loading,
  onClose,
  onPress,
  title,
}: {
  action?: string;
  copy: string;
  loading?: boolean;
  onClose: () => void;
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
      <SheetBar onClose={onClose} />
      <EmptyState
        action={action && onPress ? { label: action, onPress } : undefined}
        art={loading ? undefined : <PxiGlyph color={colors.brand} size={28} />}
        loading={loading}
        message={title ? copy : undefined}
        title={title ?? copy}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  run: { flex: 1 },
  transcript: { alignSelf: 'center', gap: 24, paddingTop: 12, width: '100%' },
  brief: { borderBottomWidth: StyleSheet.hairlineWidth, gap: 6, paddingBottom: 16 },
  footer: { gap: 14 },
  pending: { alignItems: 'center', flexDirection: 'row', gap: 6, minHeight: 24 },
  pendingSpinner: { marginLeft: -4, transform: [{ scale: 0.8 }] },
  outcome: { gap: 6 },
  notice: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  noticeText: { flex: 1 },
  noticeAction: { fontFamily: AppFonts.semibold, fontSize: 13 },
  footerButton: { alignItems: 'center', borderRadius: 24, justifyContent: 'center', minHeight: 48 },
  footerButtonLabel: { fontFamily: AppFonts.semibold, fontSize: 15 },
  disclaimer: { textAlign: 'center' },
  fill: { flexGrow: 1 },
});

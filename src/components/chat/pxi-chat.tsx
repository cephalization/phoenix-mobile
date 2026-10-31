import { useChat } from '@ai-sdk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatMessage } from '@/components/chat/chat-message';
import { ModelPicker } from '@/components/chat/model-picker';
import { SessionHistory, SessionHistoryRail } from '@/components/chat/session-history';
import { DuoArrangement, useArrangementPane } from '@/components/duo/arrangement';
import { MotionPressable } from '@/components/motion-pressable';
import { PxiGlyph } from '@/components/pxi-glyph';
import { EmptyState } from '@/components/ui/empty-state';
import { RowInset } from '@/components/ui/list-row';
import { AppFonts, MaxContentWidth, Type, useAppColors } from '@/constants/theme';
import { useDuoLayout } from '@/features/duo/layout';
import { parseServerVersion } from '@/features/pxi/actions';
import {
  createPxiId,
  createPxiMessageId,
  createPxiTransport,
  formatPxiError,
} from '@/features/pxi/client';
import { finalizeInterruptedMessages } from '@/features/pxi/message-state';
import { isSameModel, usePxiModelCatalog } from '@/features/pxi/model-catalog';
import {
  getAgentSession,
  isAgentSessionConflict,
  isAgentSessionStaleError,
  listAgentSessions,
  patchAgentSessionModel,
  PXI_AGENT_SESSIONS_MINIMUM_VERSION,
  type PxiServerSessionSummary,
} from '@/features/pxi/sessions';
import type { ModelSelection, PxiMessage } from '@/features/pxi/types';
import { compareVersions } from '@/features/session-review/api';
import { phoenixQueryKeys, usePhoenixVersion } from '@/hooks/use-phoenix-data';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';
import type { PhoenixInstance } from '@/types/instance';

const agentSessionKeys = {
  list: (instanceId: string) =>
    [...phoenixQueryKeys.instance(instanceId), 'agent-sessions'] as const,
  detail: (instanceId: string, sessionId: string) =>
    [...phoenixQueryKeys.instance(instanceId), 'agent-session', sessionId] as const,
};

/**
 * The PXI conversation: session history, model choice, transcript, and
 * composer. The chat route renders it as a `screen`; the PXI shell renders it
 * as a `pane` beside the navigation stack on regular-width windows, where the
 * leading control closes the pane instead of going back.
 */
export function PxiChat({
  instance,
  onClose,
  presentation,
}: {
  instance: PhoenixInstance;
  onClose: () => void;
  presentation: 'screen' | 'pane';
}) {
  const id = instance.id;
  const colors = useAppColors();
  const paneInsets = useSafeAreaInsets();
  const pane = useArrangementPane();

  // A floating pane stops short of a vertical system bar instead of padding
  // under it, so the stack's Back and PXI items stay visible and tappable in
  // the column the pane leaves clear.
  const barMargin = presentation === 'pane' ? paneInsets.right : 0;

  const insets = useMemo(
    () => ({ ...paneInsets, right: paneInsets.right - barMargin }),
    [barMargin, paneInsets],
  );

  // The full-screen chat on a regular-width window (a wide web window) shows
  // history as a persistent rail beside the conversation; the PXI column and
  // compact width keep the history button and bottom sheet.
  const { isRegularWidth } = useDuoLayout();
  const showRail = isRegularWidth && presentation === 'screen';

  const preferredModel = useInstanceStore((state) => state.pxiModels[id]);
  const setActiveInstanceId = useInstanceStore((state) => state.setActiveInstanceId);
  const setPxiModel = useInstanceStore((state) => state.setPxiModel);
  const catalog = usePxiModelCatalog(instance);
  const queryClient = useQueryClient();
  const version = usePhoenixVersion(instance);
  const serverVersion = parseServerVersion(version.data);

  const versionSupported =
    version.data === undefined
      ? null
      : serverVersion !== null &&
        compareVersions(serverVersion, PXI_AGENT_SESSIONS_MINIMUM_VERSION) >= 0;

  const sessions = useQuery({
    queryKey: agentSessionKeys.list(id),
    // Ephemeral sessions are contextual action runs; the chat history is the
    // durable conversations only.
    queryFn: async () =>
      (await listAgentSessions(instance)).filter((session) => !session.isEphemeral),
    enabled: versionSupported === true,
  });

  const [newSessionId] = useState(() => createPxiId('chat'));
  const [sessionChoice, setSessionChoice] = useState<{ id: string; restore: boolean } | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);

  const [replacementApprovedSessionId, setReplacementApprovedSessionId] = useState<string | null>(
    null,
  );

  const [sessionRuntimeVersion, setSessionRuntimeVersion] = useState(0);
  const latestSession = sessions.data?.[0];

  const sessionId =
    sessionChoice?.id ?? (sessions.isSuccess ? (latestSession?.id ?? newSessionId) : null);

  const shouldRestoreSession = sessionChoice?.restore ?? Boolean(latestSession);

  const savedSession = useQuery({
    queryKey: agentSessionKeys.detail(id, sessionId ?? 'new'),
    queryFn: async () => getAgentSession(instance, sessionId ?? ''),
    enabled: Boolean(sessionId && shouldRestoreSession),
    // The server owns the transcript; every restore reads it fresh instead of
    // rendering a cached copy another client may have advanced.
    gcTime: 0,
  });

  const savedModel = shouldRestoreSession ? savedSession.data?.model : undefined;

  const savedModelOption = catalog.data?.options.find(
    (option) => savedModel && isSameModel(option.selection, savedModel),
  );

  const preferredOption = catalog.data?.options.find(
    (option) => preferredModel && isSameModel(option.selection, preferredModel),
  );

  const selectedModel =
    savedModelOption?.selection ??
    preferredOption?.selection ??
    catalog.data?.defaultSelection ??
    null;

  const requiresModelReplacement = Boolean(
    savedModel && !savedModelOption && replacementApprovedSessionId !== sessionId,
  );

  useEffect(() => {
    setActiveInstanceId(id);
  }, [id, setActiveInstanceId]);

  useEffect(() => {
    if (selectedModel && !preferredOption) setPxiModel(id, selectedModel);
  }, [id, preferredOption, selectedModel, setPxiModel]);

  const selectModel = (model: ModelSelection) => {
    setPxiModel(instance.id, model);
    setPickerVisible(false);
    setSessionChoice({ id: createPxiId('chat'), restore: false });
    setReplacementApprovedSessionId(null);
  };

  const startNewChat = () => {
    setSessionChoice({ id: createPxiId('chat'), restore: false });
    setReplacementApprovedSessionId(null);
    setHistoryVisible(false);
  };

  const selectSession = (session: PxiServerSessionSummary) => {
    setSessionChoice({ id: session.id, restore: true });
    setReplacementApprovedSessionId(null);
    setHistoryVisible(false);
  };

  const reopenSession = async (serverSessionId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: agentSessionKeys.detail(instance.id, serverSessionId),
      }),
      queryClient.invalidateQueries({ queryKey: agentSessionKeys.list(instance.id) }),
    ]);
    setSessionChoice({ id: serverSessionId, restore: true });
    setSessionRuntimeVersion((runtimeVersion) => runtimeVersion + 1);
  };

  const approveModelReplacement = async () => {
    if (!sessionId || !selectedModel) return;

    try {
      await patchAgentSessionModel(instance, sessionId, selectedModel);
      setReplacementApprovedSessionId(sessionId);
      await queryClient.invalidateQueries({
        queryKey: agentSessionKeys.detail(instance.id, sessionId),
      });
      haptics.success();
    } catch {
      haptics.error();
    }
  };

  const body = version.isPending ? (
    <EmptyState loading title="Checking this server…" />
  ) : version.isError ? (
    <EmptyState
      action={{ label: 'Try again', onPress: () => void version.refetch() }}
      message={version.error.message}
      symbol={WarningSymbol}
      title="Couldn’t check this server"
    />
  ) : versionSupported === false ? (
    <EmptyState
      action={{ label: 'Check again', onPress: () => void version.refetch() }}
      message={`PXI chat requires Phoenix ${PXI_AGENT_SESSIONS_MINIMUM_VERSION.join('.')} or newer; this server is ${version.data}.`}
      symbol={{ ios: 'arrow.up.circle', android: 'upgrade', web: 'upgrade' }}
      title="Phoenix upgrade required"
    />
  ) : sessions.isPending || sessionId === null ? (
    <EmptyState loading title="Opening chats…" />
  ) : sessions.isError ? (
    <EmptyState
      action={{ label: 'Try again', onPress: () => void sessions.refetch() }}
      message={formatPxiError(sessions.error)}
      symbol={WarningSymbol}
      title="Couldn’t load chats"
    />
  ) : catalog.isPending ? (
    <EmptyState loading title="Checking available models…" />
  ) : catalog.isError ? (
    <EmptyState
      action={{ label: 'Try again', onPress: () => void catalog.refetch() }}
      message={formatPxiError(catalog.error)}
      symbol={WarningSymbol}
      title="PXI isn’t ready"
    />
  ) : shouldRestoreSession && savedSession.isPending ? (
    <EmptyState loading title="Restoring chat…" />
  ) : savedSession.isError ? (
    <EmptyState
      action={{ label: 'Start new chat', onPress: startNewChat }}
      message={formatPxiError(savedSession.error)}
      symbol={WarningSymbol}
      title="Couldn’t restore this chat"
    />
  ) : !selectedModel || catalog.data.options.length === 0 ? (
    <EmptyState
      action={{ label: 'Check again', onPress: () => void catalog.refetch() }}
      message="Configure a Phoenix-recommended agent model, then try again."
      symbol={ModelSymbol}
      title="No recommended model is configured"
    />
  ) : requiresModelReplacement ? (
    <EmptyState
      action={{ label: 'Use available model', onPress: () => void approveModelReplacement() }}
      message={`This chat used ${savedModel?.modelName}. Continuing will switch it to ${selectedModel.modelName}.`}
      symbol={ModelSymbol}
      title="Saved model is unavailable"
    />
  ) : (
    <ChatSession
      agentSessionId={shouldRestoreSession ? sessionId : undefined}
      initialMessages={finalizeInterruptedMessages(
        shouldRestoreSession ? (savedSession.data?.messages ?? []) : [],
      )}
      instance={instance}
      key={`${sessionId}:${modelIdentity(selectedModel)}:${sessionRuntimeVersion}`}
      model={selectedModel}
      modelLabel={
        catalog.data.options.find((option) => isSameModel(option.selection, selectedModel))
          ?.label ?? selectedModel.modelName
      }
      onActivateSession={() => {
        if (!sessionChoice) {
          setSessionChoice({ id: sessionId, restore: shouldRestoreSession });
        }
      }}
      onChooseModel={() => setPickerVisible(true)}
      onReload={(serverSessionId) => void reopenSession(serverSessionId)}
      sessionId={sessionId}
    />
  );

  // A pane sits beside its neighbour with no fold between them while flat, so
  // it draws the hairline that separates them.
  const paneDivider =
    presentation === 'pane' && pane !== null && !pane.isFolded
      ? pane.axis === 'horizontal'
        ? { borderLeftColor: colors.separator, borderLeftWidth: StyleSheet.hairlineWidth }
        : pane.axis === 'vertical'
          ? { borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth }
          : null
      : null;

  return (
    <View pointerEvents="box-none" style={[styles.screen, { paddingRight: barMargin }]}>
      <SafeAreaInsetsContext.Provider value={insets}>
        <View style={[styles.screen, { backgroundColor: colors.background }, paneDivider]}>
          <View
            style={[
              styles.header,
              {
                borderBottomColor: colors.separator,
                marginTop: insets.top,
                paddingLeft: 4 + insets.left,
                paddingRight: 4 + insets.right,
              },
            ]}
          >
            {presentation === 'screen' && (
              <HeaderIcon
                accessibilityLabel="Close PXI"
                onPress={onClose}
                symbol={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
              />
            )}
            {!showRail && (
              <HeaderIcon
                accessibilityLabel="Open chat history"
                onPress={() => setHistoryVisible(true)}
                symbol={{ ios: 'clock.arrow.circlepath', android: 'history', web: 'history' }}
              />
            )}
            <View
              pointerEvents="none"
              style={[
                styles.headerTitleGroup,
                { left: 100 + insets.left, right: 100 + insets.right },
              ]}
            >
              <View style={styles.headerTitleRow}>
                <PxiGlyph color={colors.brand} size={14} />
                <Text
                  accessibilityRole="header"
                  numberOfLines={1}
                  style={[styles.headerTitle, { color: colors.text }]}
                >
                  PXI
                </Text>
              </View>
              <Text numberOfLines={1} style={[Type.label, { color: colors.textSecondary }]}>
                {instance.name}
              </Text>
            </View>
            <View style={styles.headerTrailing}>
              <HeaderIcon
                accessibilityLabel="Start new chat"
                onPress={startNewChat}
                symbol={{ ios: 'square.and.pencil', android: 'edit_square', web: 'edit_square' }}
              />
              {presentation === 'pane' && (
                <HeaderIcon
                  accessibilityLabel="Close PXI"
                  onPress={onClose}
                  symbol={{ ios: 'checkmark', android: 'check', web: 'check' }}
                  weight="semibold"
                />
              )}
            </View>
          </View>

          {showRail ? (
            <DuoArrangement
              axes="horizontal"
              primary={body}
              ratio={0.66}
              secondary={
                <SessionHistoryRail
                  activeSessionId={sessionId}
                  loading={sessions.isLoading}
                  onNewChat={startNewChat}
                  onSelect={selectSession}
                  sessions={sessions.data ?? []}
                />
              }
              secondaryVisible={versionSupported === true}
            />
          ) : (
            body
          )}

          {selectedModel && catalog.data && (
            <ModelPicker
              onClose={() => setPickerVisible(false)}
              onSelect={selectModel}
              options={catalog.data.options}
              selected={selectedModel}
              visible={pickerVisible}
            />
          )}
          {!showRail && (
            <SessionHistory
              activeSessionId={sessionId}
              onClose={() => setHistoryVisible(false)}
              onSelect={selectSession}
              sessions={sessions.data ?? []}
              visible={historyVisible}
            />
          )}
        </View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

function ChatSession({
  agentSessionId,
  initialMessages,
  instance,
  model,
  modelLabel,
  onActivateSession,
  onChooseModel,
  onReload,
  sessionId,
}: {
  /** Persisted server session this chat continues; undefined until the first send creates one. */
  agentSessionId: string | undefined;
  initialMessages: PxiMessage[];
  instance: PhoenixInstance;
  model: ModelSelection;
  modelLabel: string;
  onActivateSession: () => void;
  onChooseModel: () => void;
  onReload: (serverSessionId: string) => void;
  sessionId: string;
}) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const listRef = useRef<FlatList<PxiMessage>>(null);
  const followLiveEdge = useRef(true);
  const readerIsInteracting = useRef(false);
  const contentHeight = useRef(0);

  const initialAnchorId = useRef(
    [...initialMessages].reverse().find((message) => message.role === 'user')?.id,
  );

  const initialAnchorOpened = useRef(initialMessages.length === 0);
  const [showJump, setShowJump] = useState(false);
  const [composerHeight, setComposerHeight] = useState(0);
  const [input, setInput] = useState('');
  const [wasStopped, setWasStopped] = useState(false);
  const submitting = useRef(false);
  const [serverSessionId, setServerSessionId] = useState(agentSessionId ?? null);

  const [transport] = useState(() =>
    createPxiTransport({
      agentSessionId,
      chatId: sessionId,
      instance,
      model,
      onAgentSessionCreated: setServerSessionId,
    }),
  );

  const { clearError, error, messages, regenerate, sendMessage, status, stop } =
    useChat<PxiMessage>({
      id: sessionId,
      messages: initialMessages,
      transport,
      experimental_throttle: 50,
      onError: () => haptics.error(),
      onFinish: ({ isAbort, isDisconnect, isError }) => {
        // The server persisted the turn and generates the session title; refresh
        // the history so both appear.
        void queryClient.invalidateQueries({ queryKey: agentSessionKeys.list(instance.id) });

        if (!isAbort && !isDisconnect && !isError) haptics.success();
      },
    });

  const isStreaming = status === 'submitted' || status === 'streaming';

  const isAwaitingAssistant =
    status === 'submitted' || (status === 'streaming' && messages.at(-1)?.role === 'user');

  const conflictError = Boolean(
    error &&
    (isAgentSessionConflict(error, 'agent_session_busy') || isAgentSessionStaleError(error)),
  );

  const stopOnUnmount = useEffectEvent(() => {
    void stop();
  });

  const handleAppStateChange = useEffectEvent((nextState: string) => {
    if (nextState === 'background' && isStreaming) {
      setWasStopped(true);
      void stop();
    }
  });

  useEffect(
    () => () => {
      stopOnUnmount();
    },
    [],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => subscription.remove();
  }, []);

  const scrollToLiveEdge = (animated: boolean) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ animated, offset: contentHeight.current });
    });
  };

  const scrollToLatest = () => {
    readerIsInteracting.current = false;
    followLiveEdge.current = true;
    setShowJump(false);
    scrollToLiveEdge(true);
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const isAtEnd = contentSize.height - contentOffset.y - layoutMeasurement.height < 72;

    if (readerIsInteracting.current) {
      followLiveEdge.current = isAtEnd;
      setShowJump(!isAtEnd && (isStreaming || messages.length > 0));
    }
  };

  const onMessageLayout = (messageId: string, event: LayoutChangeEvent) => {
    const offset = Math.max(0, event.nativeEvent.layout.y - 48);

    if (!initialAnchorOpened.current && messageId === initialAnchorId.current) {
      initialAnchorOpened.current = true;
      followLiveEdge.current = false;
      requestAnimationFrame(() => listRef.current?.scrollToOffset({ animated: false, offset }));

      return;
    }
  };

  const submit = async () => {
    const text = input.trim();

    if (!text || isStreaming || submitting.current) return;
    submitting.current = true;
    onActivateSession();
    setInput('');
    setWasStopped(false);
    readerIsInteracting.current = false;
    followLiveEdge.current = true;
    setShowJump(false);
    haptics.light();

    try {
      await sendMessage({
        id: createPxiMessageId(),
        role: 'user',
        parts: [{ type: 'text', text }],
      });
    } catch {
      // useChat exposes the actionable error state.
    } finally {
      submitting.current = false;
    }
  };

  const retry = () => {
    clearError();
    setWasStopped(false);
    readerIsInteracting.current = false;
    followLiveEdge.current = true;
    setShowJump(false);
    scrollToLiveEdge(false);
    void regenerate();
  };

  const reload = () => {
    if (serverSessionId) onReload(serverSessionId);
    else retry();
  };

  const canSend = input.trim().length > 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.chat}
    >
      <FlatList
        contentContainerStyle={[
          styles.transcript,
          { paddingLeft: RowInset + insets.left, paddingRight: RowInset + insets.right },
          messages.length === 0 && styles.emptyTranscript,
        ]}
        data={messages}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(message) => message.id}
        ListEmptyComponent={<EmptyChat instanceName={instance.name} />}
        ListFooterComponent={isAwaitingAssistant ? <PendingAssistant /> : undefined}
        onContentSizeChange={(_width, height) => {
          const grew = height > contentHeight.current + 1;
          contentHeight.current = height;

          if (followLiveEdge.current) {
            setShowJump(false);
            scrollToLiveEdge(false);
          } else if (grew && isStreaming) {
            setShowJump(true);
          }
        }}
        onLayout={() => {
          if (followLiveEdge.current) scrollToLiveEdge(false);
        }}
        onScroll={onScroll}
        onScrollBeginDrag={() => {
          readerIsInteracting.current = true;
          followLiveEdge.current = false;
        }}
        onScrollEndDrag={(event) => {
          onScroll(event);
          readerIsInteracting.current = false;
        }}
        onTouchStart={() => {
          if (isStreaming) {
            followLiveEdge.current = false;
          }
        }}
        ref={listRef}
        renderItem={({ item }) => (
          <View onLayout={(event) => onMessageLayout(item.id, event)}>
            <ChatMessage
              instanceBaseUrl={instance.baseUrl}
              message={item}
              onInteraction={() => {
                followLiveEdge.current = false;
                setShowJump(true);
              }}
              pending={isStreaming && item.id === messages.at(-1)?.id}
            />
          </View>
        )}
        scrollEventThrottle={32}
      />

      {showJump && (
        <MotionPressable
          accessibilityLabel="Jump to latest response"
          accessibilityRole="button"
          haptic="selection"
          hitSlop={8}
          onPress={scrollToLatest}
          style={[
            styles.jumpButton,
            {
              backgroundColor: colors.backgroundElement,
              borderColor: colors.border,
              bottom: composerHeight + 8,
            },
          ]}
        >
          <SymbolView
            name={{ ios: 'arrow.down', android: 'arrow_downward', web: 'arrow_downward' }}
            size={11}
            tintColor={colors.text}
            weight="semibold"
          />
          <Text style={[Type.label, { color: colors.text }]}>Latest</Text>
        </MotionPressable>
      )}

      <View
        onLayout={(event) => setComposerHeight(event.nativeEvent.layout.height)}
        style={[
          styles.composerArea,
          {
            paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
            paddingLeft: 12 + insets.left,
            paddingRight: 12 + insets.right,
          },
        ]}
      >
        {(error || wasStopped) && (
          <View accessibilityLiveRegion="polite" style={styles.notice}>
            <SymbolView
              name={
                error
                  ? WarningSymbol
                  : { ios: 'stop.circle', android: 'stop_circle', web: 'stop_circle' }
              }
              size={13}
              tintColor={error ? colors.danger : colors.textSecondary}
            />
            <Text style={[Type.subhead, styles.noticeText, { color: colors.textSecondary }]}>
              {error ? formatPxiError(error) : 'Response stopped before it finished.'}
            </Text>
            <MotionPressable
              accessibilityRole="button"
              haptic="selection"
              hitSlop={12}
              onPress={conflictError ? reload : retry}
            >
              <Text style={[styles.noticeAction, { color: colors.text }]}>
                {conflictError ? 'Reload chat' : 'Retry'}
              </Text>
            </MotionPressable>
          </View>
        )}

        <View
          style={[
            styles.composer,
            { backgroundColor: colors.backgroundElement, borderColor: colors.border },
          ]}
        >
          <TextInput
            accessibilityLabel="Message PXI"
            editable={!isStreaming}
            maxLength={12_000}
            multiline
            onChangeText={setInput}
            placeholder="Ask PXI"
            placeholderTextColor={colors.textTertiary}
            style={[styles.input, { color: colors.text }]}
            value={input}
          />
          <MotionPressable
            accessibilityLabel={isStreaming ? 'Stop response' : 'Send message'}
            accessibilityRole="button"
            accessibilityState={{ disabled: !isStreaming && !canSend }}
            disabled={!isStreaming && !canSend}
            haptic={isStreaming ? 'selection' : 'none'}
            hitSlop={5}
            onPress={() =>
              isStreaming ? void stop().then(() => setWasStopped(true)) : void submit()
            }
            scaleTo={0.9}
            style={[
              styles.sendButton,
              {
                backgroundColor: isStreaming || canSend ? colors.accent : colors.backgroundSelected,
              },
            ]}
          >
            <SymbolView
              name={
                isStreaming
                  ? { ios: 'stop.fill', android: 'stop', web: 'stop' }
                  : { ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' }
              }
              size={isStreaming ? 12 : 16}
              tintColor={isStreaming || canSend ? colors.accentForeground : colors.textTertiary}
              weight="bold"
            />
          </MotionPressable>
        </View>

        <View style={styles.composerMeta}>
          <MotionPressable
            accessibilityHint="Changing the model starts a new chat"
            accessibilityLabel={`Change model, currently ${modelLabel}`}
            accessibilityRole="button"
            haptic="selection"
            hitSlop={8}
            onPress={onChooseModel}
            style={styles.modelChip}
          >
            <Text
              numberOfLines={1}
              style={[Type.label, styles.modelLabel, { color: colors.textSecondary }]}
            >
              {modelLabel}
            </Text>
            <SymbolView
              name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }}
              size={9}
              tintColor={colors.textTertiary}
              weight="bold"
            />
          </MotionPressable>
          <Text style={[Type.label, { color: colors.textTertiary }]}>Read-only</Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function modelIdentity(model: ModelSelection): string {
  return model.providerType === 'custom'
    ? `custom:${model.providerId}/${model.modelName}`
    : `${model.provider}/${model.modelName}`;
}

const WarningSymbol: SymbolViewProps['name'] = {
  ios: 'exclamationmark.triangle',
  android: 'warning',
  web: 'warning',
};

const ModelSymbol: SymbolViewProps['name'] = { ios: 'cpu', android: 'memory', web: 'memory' };

function HeaderIcon({
  accessibilityLabel,
  onPress,
  symbol,
  weight = 'regular',
}: {
  accessibilityLabel: string;
  onPress: () => void;
  symbol: SymbolViewProps['name'];
  weight?: SymbolViewProps['weight'];
}) {
  const colors = useAppColors();

  return (
    <MotionPressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      haptic="selection"
      onPress={onPress}
      scaleTo={0.92}
      style={styles.headerIcon}
    >
      <SymbolView name={symbol} size={19} tintColor={colors.text} weight={weight} />
    </MotionPressable>
  );
}

function EmptyChat({ instanceName }: { instanceName: string }) {
  const colors = useAppColors();

  return (
    <EmptyState
      art={<PxiGlyph color={colors.brand} size={30} />}
      message={`PXI can look through projects, traces, sessions, and configuration on ${instanceName}. It’s read-only and can make mistakes.`}
      title="What should we investigate?"
    />
  );
}

function PendingAssistant() {
  const colors = useAppColors();

  return (
    <View
      accessibilityLabel="PXI is thinking"
      accessibilityRole="progressbar"
      style={styles.pending}
    >
      <ActivityIndicator color={colors.textTertiary} size="small" style={styles.pendingSpinner} />
      <Text style={[Type.subhead, { color: colors.textSecondary }]}>Thinking…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  chat: { alignSelf: 'center', flex: 1, maxWidth: MaxContentWidth, width: '100%' },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 52,
  },
  headerIcon: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  headerTrailing: { flexDirection: 'row', marginLeft: 'auto' },
  headerTitleGroup: { alignItems: 'center', position: 'absolute' },
  headerTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  headerTitle: { fontFamily: AppFonts.semibold, fontSize: 16, lineHeight: 20 },
  transcript: { gap: 24, paddingBottom: 16, paddingTop: 20 },
  emptyTranscript: { flexGrow: 1 },
  pending: { alignItems: 'center', flexDirection: 'row', gap: 6, minHeight: 24 },
  pendingSpinner: { marginLeft: -4, transform: [{ scale: 0.8 }] },
  jumpButton: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 12,
    position: 'absolute',
  },
  composerArea: { gap: 4, paddingTop: 6 },
  notice: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 6,
    paddingHorizontal: 8,
  },
  noticeText: { flex: 1 },
  noticeAction: { fontFamily: AppFonts.semibold, fontSize: 13 },
  composer: {
    alignItems: 'flex-end',
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    minHeight: 52,
    padding: 6,
    paddingLeft: 16,
  },
  input: {
    flex: 1,
    fontFamily: AppFonts.regular,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 132,
    minHeight: 40,
    paddingBottom: 9,
    paddingTop: 9,
    textAlignVertical: 'top',
  },
  sendButton: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  composerMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 30,
    paddingHorizontal: 12,
  },
  modelChip: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 4,
    minHeight: 30,
    paddingRight: 12,
  },
  modelLabel: { flexShrink: 1 },
});

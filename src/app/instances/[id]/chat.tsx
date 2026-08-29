import { useChat } from '@ai-sdk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatMessage } from '@/components/chat/chat-message';
import { ModelPicker } from '@/components/chat/model-picker';
import { SessionHistory } from '@/components/chat/session-history';
import { MotionPressable } from '@/components/motion-pressable';
import { PxiGlyph } from '@/components/pxi-glyph';
import { AppFonts, MaxContentWidth, useAppColors } from '@/constants/theme';
import { parseServerVersion } from '@/features/pxi/actions';
import { createPxiId, createPxiMessageId, createPxiTransport, formatPxiError } from '@/features/pxi/client';
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
  list: (instanceId: string) => [...phoenixQueryKeys.instance(instanceId), 'agent-sessions'] as const,
  detail: (instanceId: string, sessionId: string) =>
    [...phoenixQueryKeys.instance(instanceId), 'agent-session', sessionId] as const,
};

export default function PxiChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useAppColors();
  const instance = useInstanceStore((state) => state.instances.find((candidate) => candidate.id === id));
  const preferredModel = useInstanceStore((state) => (id ? state.pxiModels[id] : undefined));
  const setActiveInstanceId = useInstanceStore((state) => state.setActiveInstanceId);
  const setPxiModel = useInstanceStore((state) => state.setPxiModel);
  const catalog = usePxiModelCatalog(instance);
  const queryClient = useQueryClient();
  const version = usePhoenixVersion(instance);
  const serverVersion = parseServerVersion(version.data);
  const versionSupported = version.data === undefined
    ? null
    : serverVersion !== null && compareVersions(serverVersion, PXI_AGENT_SESSIONS_MINIMUM_VERSION) >= 0;
  const sessions = useQuery({
    queryKey: agentSessionKeys.list(instance?.id ?? 'missing'),
    queryFn: async () => {
      if (!instance) throw new Error('Phoenix instance not found.');
      // Ephemeral sessions are contextual action runs; the chat history is the
      // durable conversations only.
      return (await listAgentSessions(instance)).filter((session) => !session.isEphemeral);
    },
    enabled: Boolean(instance) && versionSupported === true,
  });
  const [newSessionId] = useState(() => createPxiId('chat'));
  const [sessionChoice, setSessionChoice] = useState<{ id: string; restore: boolean } | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [replacementApprovedSessionId, setReplacementApprovedSessionId] = useState<string | null>(null);
  const [sessionRuntimeVersion, setSessionRuntimeVersion] = useState(0);
  const latestSession = sessions.data?.[0];
  const sessionId = sessionChoice?.id ?? (sessions.isSuccess ? (latestSession?.id ?? newSessionId) : null);
  const shouldRestoreSession = sessionChoice?.restore ?? Boolean(latestSession);
  const savedSession = useQuery({
    queryKey: agentSessionKeys.detail(instance?.id ?? 'missing', sessionId ?? 'new'),
    queryFn: async () => {
      if (!instance) throw new Error('Phoenix instance not found.');
      return getAgentSession(instance, sessionId ?? '');
    },
    enabled: Boolean(instance && sessionId && shouldRestoreSession),
    // The server owns the transcript; every restore reads it fresh instead of
    // rendering a cached copy another client may have advanced.
    gcTime: 0,
  });

  const savedModel = shouldRestoreSession ? savedSession.data?.model : undefined;
  const savedModelOption = catalog.data?.options.find(
    (option) => savedModel && isSameModel(option.selection, savedModel)
  );
  const preferredOption = catalog.data?.options.find(
    (option) => preferredModel && isSameModel(option.selection, preferredModel)
  );
  const selectedModel = savedModelOption?.selection ?? preferredOption?.selection ?? catalog.data?.defaultSelection ?? null;
  const requiresModelReplacement = Boolean(
    savedModel && !savedModelOption && replacementApprovedSessionId !== sessionId
  );

  useEffect(() => {
    if (!instance) return;
    setActiveInstanceId(instance.id);
  }, [instance, setActiveInstanceId]);

  useEffect(() => {
    if (instance && selectedModel && !preferredOption) setPxiModel(instance.id, selectedModel);
  }, [instance, preferredOption, selectedModel, setPxiModel]);

  if (!instance) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.stateTitle, { color: colors.text }]}>Instance not found</Text>
        <MotionPressable onPress={() => router.replace('/')}><Text style={[styles.link, { color: colors.brand }]}>Return home</Text></MotionPressable>
      </SafeAreaView>
    );
  }

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
      queryClient.invalidateQueries({ queryKey: agentSessionKeys.detail(instance.id, serverSessionId) }),
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
      await queryClient.invalidateQueries({ queryKey: agentSessionKeys.detail(instance.id, sessionId) });
      haptics.success();
    } catch {
      haptics.error();
    }
  };

  const closeChat = () => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/instances/[id]', params: { id: instance.id } });
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <MotionPressable accessibilityLabel="Close PXI" accessibilityRole="button" onPress={closeChat} style={styles.headerIcon}>
          <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={23} tintColor={colors.text} />
        </MotionPressable>
        <MotionPressable accessibilityLabel="Open chat history" accessibilityRole="button" onPress={() => setHistoryVisible(true)} style={styles.headerIcon}>
          <SymbolView name={{ ios: 'clock.arrow.circlepath', android: 'history', web: 'history' }} size={21} tintColor={colors.text} />
        </MotionPressable>
        <View style={styles.headerTitleGroup}>
          <View style={styles.headerTitleRow}>
            <PxiGlyph color={colors.brand} size={15} />
            <Text numberOfLines={1} style={[styles.headerTitle, { color: colors.text }]}>PXI</Text>
          </View>
          <Text numberOfLines={1} style={[styles.instanceName, { color: colors.textSecondary }]}>{instance.name}</Text>
        </View>
        <MotionPressable accessibilityLabel="Start new chat" accessibilityRole="button" haptic="selection" onPress={startNewChat} style={styles.newButton}>
          <Text style={[styles.newText, { color: colors.text }]}>New</Text>
        </MotionPressable>
      </View>

      {version.isPending ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /><Text style={[styles.stateCopy, { color: colors.textSecondary }]}>Checking this server…</Text></View>
      ) : version.isError ? (
        <StateMessage title="Couldn’t check this server" copy={version.error.message} action="Try again" onAction={() => version.refetch()} />
      ) : versionSupported === false ? (
        <StateMessage
          title="Phoenix upgrade required"
          copy={`PXI chat requires Phoenix ${PXI_AGENT_SESSIONS_MINIMUM_VERSION.join('.')} or newer; this server is ${version.data}.`}
          action="Check again"
          onAction={() => version.refetch()}
        />
      ) : sessions.isPending || sessionId === null ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /><Text style={[styles.stateCopy, { color: colors.textSecondary }]}>Opening chats…</Text></View>
      ) : sessions.isError ? (
        <StateMessage title="Couldn’t load chats" copy={formatPxiError(sessions.error)} action="Try again" onAction={() => sessions.refetch()} />
      ) : catalog.isPending ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /><Text style={[styles.stateCopy, { color: colors.textSecondary }]}>Checking available models…</Text></View>
      ) : catalog.isError ? (
        <StateMessage title="PXI isn’t ready" copy={formatPxiError(catalog.error)} action="Try again" onAction={() => catalog.refetch()} />
      ) : shouldRestoreSession && savedSession.isPending ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /><Text style={[styles.stateCopy, { color: colors.textSecondary }]}>Restoring chat…</Text></View>
      ) : savedSession.isError ? (
        <StateMessage title="Couldn’t restore this chat" copy={formatPxiError(savedSession.error)} action="Start new chat" onAction={startNewChat} />
      ) : !selectedModel || catalog.data.options.length === 0 ? (
        <StateMessage title="No recommended model is configured" copy="Configure a Phoenix-recommended agent model, then try again." action="Check again" onAction={() => catalog.refetch()} />
      ) : requiresModelReplacement ? (
        <StateMessage
          title="Saved model is unavailable"
          copy={`This chat used ${savedModel?.modelName}. Continuing will switch it to ${selectedModel.modelName}.`}
          action="Use available model"
          onAction={() => void approveModelReplacement()}
        />
      ) : (
        <ChatSession
          agentSessionId={shouldRestoreSession ? sessionId : undefined}
          initialMessages={finalizeInterruptedMessages(shouldRestoreSession ? (savedSession.data?.messages ?? []) : [])}
          instance={instance}
          key={`${sessionId}:${modelIdentity(selectedModel)}:${sessionRuntimeVersion}`}
          model={selectedModel}
          modelLabel={catalog.data.options.find((option) => isSameModel(option.selection, selectedModel))?.label ?? selectedModel.modelName}
          onActivateSession={() => {
            if (!sessionChoice) {
              setSessionChoice({ id: sessionId, restore: shouldRestoreSession });
            }
          }}
          onChooseModel={() => setPickerVisible(true)}
          onReload={(serverSessionId) => void reopenSession(serverSessionId)}
          sessionId={sessionId}
        />
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
      <SessionHistory
        activeSessionId={sessionId}
        onClose={() => setHistoryVisible(false)}
        onSelect={selectSession}
        sessions={sessions.data ?? []}
        visible={historyVisible}
      />
    </SafeAreaView>
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
  const queryClient = useQueryClient();
  const listRef = useRef<FlatList<PxiMessage>>(null);
  const followLiveEdge = useRef(true);
  const readerIsInteracting = useRef(false);
  const contentHeight = useRef(0);
  const initialAnchorId = useRef([...initialMessages].reverse().find((message) => message.role === 'user')?.id);
  const initialAnchorOpened = useRef(initialMessages.length === 0);
  const [showJump, setShowJump] = useState(false);
  const [input, setInput] = useState('');
  const [wasStopped, setWasStopped] = useState(false);
  const submitting = useRef(false);
  const [serverSessionId, setServerSessionId] = useState(agentSessionId ?? null);
  const [transport] = useState(() => createPxiTransport({
    agentSessionId,
    chatId: sessionId,
    instance,
    model,
    onAgentSessionCreated: setServerSessionId,
  }));
  const { clearError, error, messages, regenerate, sendMessage, status, stop } = useChat<PxiMessage>({
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
  const isAwaitingAssistant = status === 'submitted'
    || (status === 'streaming' && messages.at(-1)?.role === 'user');
  const conflictError = Boolean(
    error && (isAgentSessionConflict(error, 'agent_session_busy') || isAgentSessionStaleError(error))
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

  useEffect(() => () => {
    stopOnUnmount();
  }, []);

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

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.chat}>
      <View style={[styles.modelBar, { borderBottomColor: colors.border }]}>
        <MotionPressable accessibilityLabel={`Change model, currently ${modelLabel}`} accessibilityRole="button" onPress={onChooseModel} style={[styles.modelButton, { backgroundColor: colors.backgroundSelected }]}>
          <View style={[styles.modelStatus, { backgroundColor: colors.success }]} />
          <Text numberOfLines={1} style={[styles.modelLabel, { color: colors.text }]}>{modelLabel}</Text>
          <View style={styles.modelChevron}>
            <SymbolView
              name={{ ios: 'chevron.up.chevron.down', android: 'unfold_more', web: 'unfold_more' }}
              size={14}
              tintColor={colors.textSecondary}
              weight="medium"
            />
          </View>
        </MotionPressable>
        <Text style={[styles.readOnly, { color: colors.textSecondary }]}>Read-only</Text>
      </View>

      <FlatList
        contentContainerStyle={[styles.transcript, messages.length === 0 && styles.emptyTranscript]}
        data={messages}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(message) => message.id}
        ListEmptyComponent={<EmptyChat instanceName={instance.name} />}
        ListFooterComponent={isAwaitingAssistant ? <PendingAssistant /> : null}
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
            />
          </View>
        )}
        scrollEventThrottle={32}
      />

      {showJump && (
        <MotionPressable accessibilityLabel="Jump to latest response" accessibilityRole="button" onPress={scrollToLatest} style={[styles.jumpButton, { backgroundColor: colors.text }]}>
          <Text style={[styles.jumpText, { color: colors.background }]}>Latest ↓</Text>
        </MotionPressable>
      )}

      {(error || wasStopped) && (
        <View style={[styles.errorBar, { backgroundColor: colors.backgroundSelected, borderColor: colors.border }]}>
          <Text style={[styles.errorText, { color: colors.text }]}>
            {error ? formatPxiError(error) : 'Response stopped before it finished.'}
          </Text>
          {conflictError
            ? <MotionPressable accessibilityRole="button" haptic="selection" onPress={reload}><Text style={[styles.retryText, { color: colors.brand }]}>Reload chat</Text></MotionPressable>
            : <MotionPressable accessibilityRole="button" haptic="selection" onPress={retry}><Text style={[styles.retryText, { color: colors.brand }]}>Retry</Text></MotionPressable>}
        </View>
      )}

      <View style={[styles.composerWrap, { borderTopColor: colors.border }]}>
        <View style={[styles.composer, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
          <TextInput
            accessibilityLabel="Message PXI"
            editable={!isStreaming}
            maxLength={12_000}
            multiline
            onChangeText={setInput}
            placeholder="Ask about this Phoenix instance"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { color: colors.text }]}
            value={input}
          />
          <MotionPressable
            accessibilityLabel={isStreaming ? 'Stop response' : 'Send message'}
            accessibilityRole="button"
            disabled={!isStreaming && input.trim().length === 0}
            haptic={isStreaming ? 'selection' : 'none'}
            onPress={() => isStreaming ? void stop().then(() => setWasStopped(true)) : void submit()}
            scaleTo={0.9}
            style={[
              styles.sendButton,
              { backgroundColor: colors.accent },
              !isStreaming && input.trim().length === 0 && styles.disabled,
            ]}>
            {isStreaming ? <View style={[styles.stopIcon, { backgroundColor: colors.accentForeground }]} /> : <Text style={[styles.sendIcon, { color: colors.accentForeground }]}>↑</Text>}
          </MotionPressable>
        </View>
        <Text style={[styles.disclaimer, { color: colors.textSecondary }]}>PXI can make mistakes. Changes are disabled.</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

function modelIdentity(model: ModelSelection): string {
  return model.providerType === 'custom'
    ? `custom:${model.providerId}/${model.modelName}`
    : `${model.provider}/${model.modelName}`;
}

function EmptyChat({ instanceName }: { instanceName: string }) {
  const colors = useAppColors();
  return (
    <View style={styles.emptyChat}>
      <View style={[styles.emptyGlyph, { backgroundColor: colors.accentSoft }]}><PxiGlyph color={colors.brand} size={30} /></View>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>What should we investigate?</Text>
      <Text style={[styles.emptyCopy, { color: colors.textSecondary }]}>PXI can inspect projects, traces, sessions, and configuration on {instanceName}.</Text>
    </View>
  );
}

function PendingAssistant() {
  const colors = useAppColors();
  return (
    <View accessibilityLabel="PXI is thinking" accessibilityRole="progressbar" style={styles.pendingAssistant}>
      <View style={styles.pendingAssistantLabel}>
        <PxiGlyph color={colors.brand} size={15} />
        <Text style={[styles.pendingAssistantName, { color: colors.textSecondary }]}>PXI</Text>
      </View>
      <View style={styles.pendingAssistantState}>
        <ActivityIndicator color={colors.brand} size="small" style={styles.pendingAssistantSpinner} />
        <Text style={[styles.thinking, { color: colors.textSecondary }]}>Thinking…</Text>
      </View>
    </View>
  );
}

function StateMessage({ action, copy, onAction, title }: { action: string; copy: string; onAction: () => void; title: string }) {
  const colors = useAppColors();
  return (
    <View style={styles.center}>
      <PxiGlyph color={colors.brand} size={30} />
      <Text style={[styles.stateTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.stateCopy, { color: colors.textSecondary }]}>{copy}</Text>
      <MotionPressable accessibilityRole="button" onPress={onAction} style={[styles.stateButton, { backgroundColor: colors.accent }]}><Text style={[styles.stateButtonText, { color: colors.accentForeground }]}>{action}</Text></MotionPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  chat: { alignSelf: 'center', flex: 1, maxWidth: MaxContentWidth, width: '100%' },
  header: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', minHeight: 58, paddingHorizontal: 12 },
  headerIcon: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  headerTitleGroup: { alignItems: 'center', gap: 1, left: 108, position: 'absolute', right: 108 },
  headerTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  headerTitle: { fontFamily: AppFonts.semibold, fontSize: 16 },
  instanceName: { fontFamily: AppFonts.regular, fontSize: 11, maxWidth: 220 },
  newButton: { alignItems: 'center', height: 48, justifyContent: 'center', marginLeft: 'auto', minWidth: 48 },
  newText: { fontFamily: AppFonts.medium, fontSize: 14 },
  modelBar: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: 16 },
  modelButton: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 7, maxWidth: '72%', minHeight: 34, paddingHorizontal: 10 },
  modelStatus: { borderRadius: 4, height: 7, width: 7 },
  modelLabel: { flexShrink: 1, fontFamily: AppFonts.medium, fontSize: 12 },
  modelChevron: { alignItems: 'center', height: 24, justifyContent: 'center', width: 20 },
  readOnly: { fontFamily: AppFonts.medium, fontSize: 11, letterSpacing: 0.3, textTransform: 'uppercase' },
  transcript: { gap: 28, paddingHorizontal: 18, paddingVertical: 24 },
  emptyTranscript: { flexGrow: 1 },
  emptyChat: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', paddingHorizontal: 24 },
  emptyGlyph: { alignItems: 'center', borderRadius: 24, height: 66, justifyContent: 'center', marginBottom: 5, width: 66 },
  emptyTitle: { fontFamily: AppFonts.semibold, fontSize: 24, letterSpacing: -0.5, textAlign: 'center' },
  emptyCopy: { fontFamily: AppFonts.regular, fontSize: 15, lineHeight: 22, maxWidth: 380, textAlign: 'center' },
  pendingAssistant: { gap: 11, paddingRight: 8 },
  pendingAssistantLabel: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  pendingAssistantName: { fontFamily: AppFonts.semibold, fontSize: 12, letterSpacing: 0.5 },
  pendingAssistantSpinner: { transform: [{ translateX: -1.5 }] },
  pendingAssistantState: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 22 },
  thinking: { fontFamily: AppFonts.regular, fontSize: 12, fontStyle: 'italic' },
  center: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', padding: 28 },
  stateTitle: { fontFamily: AppFonts.semibold, fontSize: 22, letterSpacing: -0.4, textAlign: 'center' },
  stateCopy: { fontFamily: AppFonts.regular, fontSize: 15, lineHeight: 22, maxWidth: 360, textAlign: 'center' },
  stateButton: { borderRadius: 14, justifyContent: 'center', marginTop: 4, minHeight: 48, paddingHorizontal: 17 },
  stateButtonText: { fontFamily: AppFonts.semibold, fontSize: 14 },
  link: { fontFamily: AppFonts.medium, fontSize: 14 },
  jumpButton: { alignSelf: 'center', borderRadius: 18, bottom: 116, minHeight: 38, paddingHorizontal: 14, position: 'absolute', justifyContent: 'center' },
  jumpText: { fontFamily: AppFonts.medium, fontSize: 12 },
  errorBar: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, marginHorizontal: 16, marginBottom: 8, padding: 11 },
  errorText: { flex: 1, fontFamily: AppFonts.regular, fontSize: 12, lineHeight: 17 },
  retryText: { fontFamily: AppFonts.semibold, fontSize: 13 },
  composerWrap: { borderTopWidth: 1, gap: 6, paddingHorizontal: 12, paddingTop: 10 },
  composer: { alignItems: 'flex-end', borderRadius: 22, borderWidth: 1, flexDirection: 'row', gap: 8, minHeight: 54, padding: 6, paddingLeft: 15 },
  input: {
    flex: 1,
    fontFamily: AppFonts.regular,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 128,
    minHeight: 40,
    paddingBottom: 9,
    paddingTop: 9,
    textAlignVertical: 'top',
  },
  sendButton: { alignItems: 'center', borderRadius: 18, height: 40, justifyContent: 'center', width: 40 },
  disabled: { opacity: 0.28 },
  sendIcon: { fontFamily: AppFonts.semibold, fontSize: 24, lineHeight: 27 },
  stopIcon: { borderRadius: 2, height: 12, width: 12 },
  disclaimer: { fontFamily: AppFonts.regular, fontSize: 10, paddingBottom: 3, textAlign: 'center' },
});

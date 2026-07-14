import { useChat } from '@ai-sdk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
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
import { createPxiId, createPxiTransport, formatPxiError } from '@/features/pxi/client';
import { isSameModel, usePxiModelCatalog } from '@/features/pxi/model-catalog';
import type { ModelSelection, PxiMessage } from '@/features/pxi/types';
import { haptics } from '@/lib/haptics';
import {
  deletePxiSession,
  getPxiHistoryGeneration,
  getPxiSession,
  listPxiSessions,
  PxiSessionConflictError,
  PxiSessionDeletedError,
  savePxiSession,
  type PxiSessionSummary,
  type StoredPxiSession,
} from '@/lib/pxi-session-db';
import { useInstanceStore } from '@/store/instances';
import type { PhoenixInstance } from '@/types/instance';

export default function PxiChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useAppColors();
  const instance = useInstanceStore((state) => state.instances.find((candidate) => candidate.id === id));
  const preferredModel = useInstanceStore((state) => (id ? state.pxiModels[id] : undefined));
  const setActiveInstanceId = useInstanceStore((state) => state.setActiveInstanceId);
  const setPxiModel = useInstanceStore((state) => state.setPxiModel);
  const catalog = usePxiModelCatalog(instance);
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: ['pxi', 'sessions', instance?.id ?? 'missing'],
    queryFn: () => listPxiSessions(instance?.id ?? ''),
    enabled: Boolean(instance),
  });
  const historyGeneration = useQuery({
    queryKey: ['pxi', 'history-generation'],
    queryFn: getPxiHistoryGeneration,
  });
  const [newSessionId] = useState(() => createPxiId('session'));
  const [sessionChoice, setSessionChoice] = useState<{
    generation: number;
    id: string;
    restore: boolean;
  } | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [replacementApprovedSessionId, setReplacementApprovedSessionId] = useState<string | null>(null);
  const [sessionRuntimeVersion, setSessionRuntimeVersion] = useState(0);
  const latestSession = sessions.data?.[0];
  const sessionId = sessionChoice?.id ?? (sessions.isSuccess ? (latestSession?.id ?? newSessionId) : null);
  const shouldRestoreSession = sessionChoice?.restore ?? Boolean(latestSession);
  const activeSummary = sessions.data?.find((session) => session.id === sessionId);
  const sessionGeneration = sessionChoice?.generation ?? activeSummary?.generation ?? historyGeneration.data ?? 0;
  const savedSession = useQuery({
    queryKey: ['pxi', 'session', sessionId ?? 'new'],
    queryFn: () => getPxiSession(sessionId ?? ''),
    enabled: Boolean(sessionId && shouldRestoreSession),
  });

  const savedModelOption = catalog.data?.options.find(
    (option) => activeSummary && isSameModel(option.selection, activeSummary.model)
  );
  const preferredOption = catalog.data?.options.find(
    (option) => preferredModel && isSameModel(option.selection, preferredModel)
  );
  const selectedModel = savedModelOption?.selection ?? preferredOption?.selection ?? catalog.data?.defaultSelection ?? null;
  const requiresModelReplacement = Boolean(
    activeSummary && !savedModelOption && replacementApprovedSessionId !== sessionId
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
    setSessionChoice({ generation: historyGeneration.data ?? 0, id: createPxiId('session'), restore: false });
    setReplacementApprovedSessionId(null);
  };

  const startNewChat = () => {
    setSessionChoice({ generation: historyGeneration.data ?? 0, id: createPxiId('session'), restore: false });
    setReplacementApprovedSessionId(null);
    setHistoryVisible(false);
  };

  const selectSession = (session: PxiSessionSummary) => {
    setSessionChoice({ generation: session.generation, id: session.id, restore: true });
    setReplacementApprovedSessionId(null);
    setHistoryVisible(false);
  };

  const removeSession = async (removedSessionId: string) => {
    try {
      await deletePxiSession(removedSessionId);
      queryClient.removeQueries({ queryKey: ['pxi', 'session', removedSessionId] });
      await queryClient.invalidateQueries({ queryKey: ['pxi', 'sessions', instance.id] });
      if (removedSessionId === sessionId) startNewChat();
      haptics.success();
    } catch {
      haptics.error();
    }
  };

  const reopenSession = async () => {
    if (!sessionId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pxi', 'session', sessionId] }),
      queryClient.invalidateQueries({ queryKey: ['pxi', 'sessions', instance.id] }),
    ]);
    const summaries = queryClient.getQueryData<PxiSessionSummary[]>(['pxi', 'sessions', instance.id]);
    const summary = summaries?.find((candidate) => candidate.id === sessionId);
    if (!summary) {
      startNewChat();
      return;
    }
    setSessionChoice({ generation: summary.generation, id: summary.id, restore: true });
    setSessionRuntimeVersion((version) => version + 1);
  };

  const closeChat = () => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/instances/[id]', params: { id: instance.id } });
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <MotionPressable accessibilityLabel="Close PXI" accessibilityRole="button" haptic="selection" onPress={closeChat} style={styles.headerIcon}>
          <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={23} tintColor={colors.text} />
        </MotionPressable>
        <MotionPressable accessibilityLabel="Open chat history" accessibilityRole="button" haptic="selection" onPress={() => setHistoryVisible(true)} style={styles.headerIcon}>
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

      {sessions.isPending || historyGeneration.isPending || sessionId === null ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /><Text style={[styles.stateCopy, { color: colors.textSecondary }]}>Opening chat history…</Text></View>
      ) : sessions.isError ? (
        <StateMessage title="Couldn’t load chat history" copy="Phoenix Mobile could not open its local chat database." action="Try again" onAction={() => sessions.refetch()} />
      ) : historyGeneration.isError ? (
        <StateMessage title="Couldn’t open local storage" copy="Phoenix Mobile could not prepare its chat database." action="Try again" onAction={() => historyGeneration.refetch()} />
      ) : catalog.isPending ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /><Text style={[styles.stateCopy, { color: colors.textSecondary }]}>Checking available models…</Text></View>
      ) : catalog.isError ? (
        <StateMessage title="PXI isn’t ready" copy={formatPxiError(catalog.error)} action="Try again" onAction={() => catalog.refetch()} />
      ) : !selectedModel || catalog.data.options.length === 0 ? (
        <StateMessage title="No recommended model is configured" copy="Configure a Phoenix-recommended agent model, then try again." action="Check again" onAction={() => catalog.refetch()} />
      ) : requiresModelReplacement ? (
        <StateMessage
          title="Saved model is unavailable"
          copy={`This chat used ${activeSummary?.model.modelName}. Continuing will switch it to ${selectedModel.modelName}.`}
          action="Use available model"
          onAction={() => setReplacementApprovedSessionId(sessionId)}
        />
      ) : shouldRestoreSession && savedSession.isPending ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /><Text style={[styles.stateCopy, { color: colors.textSecondary }]}>Restoring chat…</Text></View>
      ) : savedSession.isError ? (
        <StateMessage title="Couldn’t restore this chat" copy="The saved conversation could not be read from local storage." action="Start new chat" onAction={startNewChat} />
      ) : (
        <ChatSession
          generation={sessionGeneration}
          initialMessages={savedSession.data?.messages ?? []}
          initialRevision={savedSession.data?.revision ?? activeSummary?.revision ?? 0}
          instance={instance}
          key={`${sessionId}:${sessionGeneration}:${modelIdentity(selectedModel)}:${sessionRuntimeVersion}`}
          model={selectedModel}
          modelLabel={catalog.data.options.find((option) => isSameModel(option.selection, selectedModel))?.label ?? selectedModel.modelName}
          onActivateSession={() => {
            if (!sessionChoice) {
              setSessionChoice({
                generation: sessionGeneration,
                id: sessionId,
                restore: Boolean(activeSummary),
              });
            }
          }}
          onChooseModel={() => setPickerVisible(true)}
          onNewChat={startNewChat}
          onReopenSession={() => void reopenSession()}
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
        onDelete={(removedSessionId) => void removeSession(removedSessionId)}
        onNew={startNewChat}
        onSelect={selectSession}
        sessions={sessions.data ?? []}
        visible={historyVisible}
      />
    </SafeAreaView>
  );
}

function ChatSession({
  generation,
  initialMessages,
  initialRevision,
  instance,
  model,
  modelLabel,
  onActivateSession,
  onChooseModel,
  onNewChat,
  onReopenSession,
  sessionId,
}: {
  generation: number;
  initialMessages: PxiMessage[];
  initialRevision: number;
  instance: PhoenixInstance;
  model: ModelSelection;
  modelLabel: string;
  onActivateSession: () => void;
  onChooseModel: () => void;
  onNewChat: () => void;
  onReopenSession: () => void;
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
  const pendingAnchorId = useRef<string | null>(null);
  const turnAnchorInProgress = useRef(false);
  const [showJump, setShowJump] = useState(false);
  const [input, setInput] = useState('');
  const [wasStopped, setWasStopped] = useState(false);
  const [isPersistingSubmission, setIsPersistingSubmission] = useState(false);
  const [persistenceIssue, setPersistenceIssue] = useState<'conflict' | 'deleted' | 'error' | null>(null);
  const persistedMessages = useRef(JSON.stringify(initialMessages));
  const revision = useRef(initialRevision);
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve());
  const persistenceSucceeded = useRef(true);
  const lastStreamSnapshotAt = useRef(0);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const persistMessages = useCallback(async (nextMessages: PxiMessage[]): Promise<boolean> => {
    if (nextMessages.length === 0) return true;
    const serialized = JSON.stringify(nextMessages);
    if (serialized === persistedMessages.current) {
      await persistenceQueue.current;
      return persistenceSucceeded.current;
    }
    persistedMessages.current = serialized;
    const save = persistenceQueue.current.then(async () => {
      const saved = await savePxiSession({
        generation,
        id: sessionId,
        instanceId: instance.id,
        messages: nextMessages,
        model,
        revision: revision.current,
      });
      if (!saved) return;
      revision.current = saved.revision;
      persistenceSucceeded.current = true;
      if (mounted.current) setPersistenceIssue(null);
      queryClient.setQueryData<StoredPxiSession>(['pxi', 'session', sessionId], saved);
      await queryClient.invalidateQueries({ queryKey: ['pxi', 'sessions', instance.id] });
    });
    persistenceQueue.current = save.catch(() => undefined);
    try {
      await save;
    } catch (error) {
      persistenceSucceeded.current = false;
      persistedMessages.current = '';
      if (mounted.current) {
        setPersistenceIssue(
          error instanceof PxiSessionConflictError
            ? 'conflict'
            : error instanceof PxiSessionDeletedError
              ? 'deleted'
              : 'error'
        );
      }
      return false;
    }
    return true;
  }, [generation, instance.id, model, queryClient, sessionId]);
  const [transport] = useState(() => createPxiTransport({ instance, model, sessionId }));
  const { clearError, error, messages, regenerate, sendMessage, status, stop } = useChat<PxiMessage>({
    id: sessionId,
    messages: initialMessages,
    transport,
    experimental_throttle: 50,
    onError: () => haptics.error(),
    onFinish: ({ isAbort, isDisconnect, isError, messages: finalMessages }) => {
      void persistMessages(finalMessages);
      if (!isAbort && !isDisconnect && !isError) haptics.success();
    },
  });
  const isStreaming = status === 'submitted' || status === 'streaming';
  const persistenceBlocked = persistenceIssue === 'conflict' || persistenceIssue === 'deleted';
  const sendDisabled = persistenceBlocked || isPersistingSubmission;
  const stopOnUnmount = useEffectEvent(() => {
    void persistMessages(messages);
    void stop();
  });
  const handleAppStateChange = useEffectEvent((nextState: string) => {
    if (nextState !== 'active' && isStreaming) {
      setWasStopped(true);
      void persistMessages(messages).finally(() => void stop());
    }
  });

  useEffect(() => () => {
    mounted.current = false;
    stopOnUnmount();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (status !== 'streaming' || messages.length === 0) return;
    const delay = Math.max(0, 1_000 - (Date.now() - lastStreamSnapshotAt.current));
    const timeout = setTimeout(() => {
      lastStreamSnapshotAt.current = Date.now();
      void persistMessages(messages);
    }, delay);
    return () => clearTimeout(timeout);
  }, [messages, persistMessages, status]);

  useEffect(() => {
    if (persistenceIssue === 'conflict' || persistenceIssue === 'deleted') void stop();
  }, [persistenceIssue, stop]);

  const scrollToLatest = () => {
    followLiveEdge.current = true;
    setShowJump(false);
    listRef.current?.scrollToEnd({ animated: true });
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
    if (messageId === pendingAnchorId.current) {
      pendingAnchorId.current = null;
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ animated: false, offset });
        requestAnimationFrame(() => { turnAnchorInProgress.current = false; });
      });
    }
  };

  const submit = async () => {
    const text = input.trim();
    if (!text || isStreaming || persistenceBlocked || submitting.current) return;
    submitting.current = true;
    setIsPersistingSubmission(true);
    onActivateSession();
    const userMessage: PxiMessage = {
      id: createPxiId('message'),
      role: 'user',
      parts: [{ type: 'text', text }],
    };
    pendingAnchorId.current = userMessage.id;
    turnAnchorInProgress.current = true;
    const saved = await persistMessages([...messages, userMessage]);
    if (!saved) {
      pendingAnchorId.current = null;
      turnAnchorInProgress.current = false;
      submitting.current = false;
      if (mounted.current) setIsPersistingSubmission(false);
      return;
    }
    if (!mounted.current) {
      submitting.current = false;
      return;
    }
    setInput('');
    setWasStopped(false);
    followLiveEdge.current = true;
    setShowJump(false);
    haptics.light();
    setIsPersistingSubmission(false);
    try {
      await sendMessage(userMessage);
    } catch {
      // useChat exposes the actionable error state.
    } finally {
      submitting.current = false;
      if (mounted.current) setIsPersistingSubmission(false);
    }
  };

  const retry = () => {
    clearError();
    setWasStopped(false);
    followLiveEdge.current = true;
    void regenerate();
  };

  const retryPersistence = () => {
    setPersistenceIssue(null);
    void persistMessages(messages);
  };

  const persistenceAction = persistenceIssue === 'conflict'
    ? { label: 'Reopen', run: onReopenSession }
    : persistenceIssue === 'deleted'
      ? { label: 'New chat', run: onNewChat }
      : { label: 'Retry save', run: retryPersistence };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.chat}>
      <View style={[styles.modelBar, { borderBottomColor: colors.border }]}>
        <MotionPressable accessibilityLabel={`Change model, currently ${modelLabel}`} accessibilityRole="button" haptic="selection" onPress={onChooseModel} style={[styles.modelButton, { backgroundColor: colors.backgroundSelected }]}>
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
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onContentSizeChange={(_width, height) => {
          const grew = height > contentHeight.current + 1;
          contentHeight.current = height;
          if (followLiveEdge.current && !turnAnchorInProgress.current) {
            requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
          } else if (grew && isStreaming) {
            setShowJump(true);
          }
        }}
        onLayout={() => {
          if (followLiveEdge.current) requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
        }}
        onMomentumScrollBegin={() => { readerIsInteracting.current = true; }}
        onMomentumScrollEnd={() => { readerIsInteracting.current = false; }}
        onScroll={onScroll}
        onScrollBeginDrag={() => {
          readerIsInteracting.current = true;
          followLiveEdge.current = false;
          turnAnchorInProgress.current = false;
        }}
        onScrollEndDrag={(event) => {
          onScroll(event);
          readerIsInteracting.current = false;
        }}
        onTouchStart={() => {
          if (isStreaming) {
            followLiveEdge.current = false;
            turnAnchorInProgress.current = false;
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
                turnAnchorInProgress.current = false;
                setShowJump(true);
              }}
            />
          </View>
        )}
        scrollEventThrottle={32}
      />

      {showJump && (
        <MotionPressable accessibilityLabel="Jump to latest response" accessibilityRole="button" haptic="selection" onPress={scrollToLatest} style={[styles.jumpButton, { backgroundColor: colors.text }]}>
          <Text style={[styles.jumpText, { color: colors.background }]}>Latest ↓</Text>
        </MotionPressable>
      )}

      {(error || wasStopped || persistenceIssue) && (
        <View style={[styles.errorBar, { backgroundColor: colors.backgroundSelected, borderColor: colors.border }]}>
          <Text style={[styles.errorText, { color: colors.text }]}>
            {error
              ? formatPxiError(error)
              : wasStopped
                ? 'Response stopped before it finished.'
                : persistenceIssue === 'conflict'
                  ? 'This chat changed in another window. Reopen it before continuing.'
                  : persistenceIssue === 'deleted'
                    ? 'This chat was deleted and cannot be saved again.'
                    : 'This chat could not be saved locally.'}
          </Text>
          {persistenceIssue
            ? <MotionPressable accessibilityRole="button" haptic="selection" onPress={persistenceAction.run}><Text style={[styles.retryText, { color: colors.brand }]}>{persistenceAction.label}</Text></MotionPressable>
            : <MotionPressable accessibilityRole="button" haptic="selection" onPress={retry}><Text style={[styles.retryText, { color: colors.brand }]}>Retry</Text></MotionPressable>}
        </View>
      )}

      <View style={[styles.composerWrap, { borderTopColor: colors.border }]}>
        <View style={[styles.composer, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
          <TextInput
            accessibilityLabel="Message PXI"
            editable={!isStreaming && !sendDisabled}
            maxLength={12_000}
            multiline
            onChangeText={setInput}
            placeholder="Ask about this Phoenix instance"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { color: colors.text }]}
            value={input}
          />
          <MotionPressable
            accessibilityLabel={isStreaming ? 'Stop response' : isPersistingSubmission ? 'Saving message' : 'Send message'}
            accessibilityRole="button"
            disabled={sendDisabled || (!isStreaming && input.trim().length === 0)}
            haptic={isStreaming ? 'selection' : 'light'}
            onPress={() => isStreaming ? void stop().then(() => setWasStopped(true)) : void submit()}
            scaleTo={0.9}
            style={[
              styles.sendButton,
              { backgroundColor: colors.accent },
              (sendDisabled || (!isStreaming && input.trim().length === 0)) && styles.disabled,
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
  headerTitleGroup: { alignItems: 'center', flex: 1, gap: 1 },
  headerTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  headerTitle: { fontFamily: AppFonts.semibold, fontSize: 16 },
  instanceName: { fontFamily: AppFonts.regular, fontSize: 11, maxWidth: 220 },
  newButton: { alignItems: 'center', height: 48, justifyContent: 'center', minWidth: 48 },
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

import { SymbolView } from 'expo-symbols';
import { FlatList, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatBottomSheet } from '@/components/chat/chat-bottom-sheet';
import { MotionPressable } from '@/components/motion-pressable';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow, RowInset, RowSeparator } from '@/components/ui/list-row';
import { Type, useAppColors } from '@/constants/theme';
import type { PxiServerSessionSummary } from '@/features/pxi/sessions';
import { formatRelativeTime } from '@/lib/format';

function sessionTitle(session: PxiServerSessionSummary): string {
  return session.title.trim() || 'Untitled chat';
}

/** Compact-width presentation: the history list inside the native bottom sheet. */
export function SessionHistory({
  activeSessionId,
  onClose,
  onSelect,
  sessions,
  visible,
}: {
  activeSessionId: string | null;
  onClose: () => void;
  onSelect: (session: PxiServerSessionSummary) => void;
  sessions: PxiServerSessionSummary[];
  visible: boolean;
}) {
  return (
    <ChatBottomSheet flush onClose={onClose} title="History" visible={visible}>
      <SessionHistoryList
        activeSessionId={activeSessionId}
        onSelect={onSelect}
        sessions={sessions}
        variant="flat"
      />
    </ChatBottomSheet>
  );
}

/**
 * Regular-width presentation: a persistent rail that replaces the bottom
 * sheet. Rendered as the secondary pane of the chat's `DuoArrangement`, so
 * its container has a definite size and the list may flex to fill it.
 */
export function SessionHistoryRail({
  activeSessionId,
  loading,
  onNewChat,
  onSelect,
  sessions,
}: {
  activeSessionId: string | null;
  loading: boolean;
  onNewChat: () => void;
  onSelect: (session: PxiServerSessionSummary) => void;
  sessions: PxiServerSessionSummary[];
}) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      accessibilityLabel="Chat history"
      style={[
        styles.rail,
        {
          backgroundColor: colors.sidebar,
          borderLeftColor: colors.separator,
          paddingBottom: insets.bottom,
          paddingRight: insets.right,
        },
      ]}
    >
      <View style={styles.railHeader}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={[Type.label, styles.railTitle, { color: colors.textSecondary }]}
        >
          History
        </Text>
        <MotionPressable
          accessibilityLabel="Start new chat"
          accessibilityRole="button"
          haptic="selection"
          onPress={onNewChat}
          style={styles.railNewButton}
        >
          <SymbolView
            name={{ ios: 'square.and.pencil', android: 'edit_square', web: 'edit_square' }}
            size={18}
            tintColor={colors.text}
          />
        </MotionPressable>
      </View>
      <SessionHistoryList
        activeSessionId={activeSessionId}
        loading={loading}
        onSelect={onSelect}
        sessions={sessions}
        style={styles.railList}
        variant="sidebar"
      />
    </View>
  );
}

/**
 * The history rows and their empty state, shared by the sheet and the rail.
 * `flat` rows mark the open chat with a checkmark; `sidebar` rows with a fill.
 */
export function SessionHistoryList({
  activeSessionId,
  loading = false,
  onSelect,
  sessions,
  style,
  variant,
}: {
  activeSessionId: string | null;
  /** Show a spinner instead of the empty state while the first page loads. */
  loading?: boolean;
  onSelect: (session: PxiServerSessionSummary) => void;
  sessions: PxiServerSessionSummary[];
  style?: StyleProp<ViewStyle>;
  variant: 'flat' | 'sidebar';
}) {
  const colors = useAppColors();

  return (
    <FlatList
      contentContainerStyle={[styles.listContent, sessions.length === 0 && styles.emptyList]}
      data={sessions}
      ItemSeparatorComponent={variant === 'flat' ? RowSeparator : undefined}
      keyExtractor={(session) => session.id}
      ListEmptyComponent={
        loading ? (
          <EmptyState loading title="Loading chats" />
        ) : (
          <EmptyState
            message="Chats appear here after you send a message. They’re stored on this Phoenix server."
            symbol={{ ios: 'clock', android: 'history', web: 'history' }}
            title="No chats yet"
          />
        )
      }
      renderItem={({ item }) => {
        const active = item.id === activeSessionId;
        const title = sessionTitle(item);
        const time = formatRelativeTime(item.updatedAt);

        return (
          <ListRow
            accessibilityLabel={`${title}, ${time}${active ? ', open' : ''}`}
            meta={time}
            onPress={() => onSelect(item)}
            selected={variant === 'sidebar' && active}
            title={title}
            trailing={
              variant === 'flat' && active ? (
                <SymbolView
                  name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                  size={15}
                  tintColor={colors.text}
                  weight="semibold"
                />
              ) : null
            }
            variant={variant}
          />
        );
      }}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  rail: { borderLeftWidth: StyleSheet.hairlineWidth, flex: 1 },
  railHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 52,
    paddingLeft: RowInset,
    paddingRight: 4,
  },
  railTitle: { flex: 1 },
  railNewButton: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  railList: { flex: 1 },
  listContent: { paddingBottom: 12 },
  emptyList: { flexGrow: 1 },
});

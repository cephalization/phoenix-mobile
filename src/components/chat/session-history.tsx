import { SymbolView } from 'expo-symbols';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatBottomSheet } from '@/components/chat/chat-bottom-sheet';
import { MotionPressable } from '@/components/motion-pressable';
import { PxiGlyph } from '@/components/pxi-glyph';
import { AppFonts, useAppColors } from '@/constants/theme';
import type { PxiServerSessionSummary } from '@/features/pxi/sessions';

const SUBTITLE = 'Stored on this Phoenix instance';

function formatSessionDate(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();

  return isToday
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], {
        day: 'numeric',
        month: 'short',
        year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
      });
}

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
  const colors = useAppColors();

  return (
    <ChatBottomSheet onClose={onClose} subtitle={SUBTITLE} title="Chat history" visible={visible}>
      <SessionHistoryList
        activeSessionId={activeSessionId}
        onSelect={onSelect}
        sessions={sessions}
        style={[
          styles.card,
          { backgroundColor: colors.backgroundElement, borderColor: colors.border },
        ]}
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
          backgroundColor: colors.backgroundElement,
          borderColor: colors.border,
          paddingBottom: insets.bottom,
          paddingRight: insets.right,
        },
      ]}
    >
      <View style={styles.railHeader}>
        <View style={styles.railHeadingGroup}>
          <Text numberOfLines={1} style={[styles.railTitle, { color: colors.text }]}>
            Chat history
          </Text>
          <Text numberOfLines={1} style={[styles.railSubtitle, { color: colors.textSecondary }]}>
            {SUBTITLE}
          </Text>
        </View>
        <MotionPressable
          accessibilityLabel="Start new chat"
          accessibilityRole="button"
          haptic="selection"
          onPress={onNewChat}
          style={styles.railNewButton}
        >
          <SymbolView
            name={{ ios: 'square.and.pencil', android: 'edit_square', web: 'edit_square' }}
            size={20}
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
      />
    </View>
  );
}

/** The history rows and their empty state, shared by the sheet and the rail. */
export function SessionHistoryList({
  activeSessionId,
  loading = false,
  onSelect,
  sessions,
  style,
}: {
  activeSessionId: string | null;
  /** Show a spinner instead of the empty state while the first page loads. */
  loading?: boolean;
  onSelect: (session: PxiServerSessionSummary) => void;
  sessions: PxiServerSessionSummary[];
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useAppColors();
  const separator = <View style={[styles.separator, { backgroundColor: colors.border }]} />;

  return (
    <FlatList
      contentContainerStyle={[styles.listContent, sessions.length === 0 && styles.emptyList]}
      data={sessions}
      ItemSeparatorComponent={separator}
      keyExtractor={(session) => session.id}
      ListEmptyComponent={loading ? <LoadingState /> : <EmptyState />}
      renderItem={({ item }) => (
        <SessionRow
          active={item.id === activeSessionId}
          onSelect={() => onSelect(item)}
          session={item}
        />
      )}
      style={style}
    />
  );
}

function LoadingState() {
  const colors = useAppColors();

  return (
    <View
      accessibilityLabel="Loading chats"
      accessibilityRole="progressbar"
      style={styles.emptyState}
    >
      <ActivityIndicator color={colors.brand} />
    </View>
  );
}

function EmptyState() {
  const colors = useAppColors();

  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyGlyph, { backgroundColor: colors.accentSoft }]}>
        <PxiGlyph color={colors.brand} size={28} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>No saved chats</Text>
      <Text style={[styles.emptyCopy, { color: colors.textSecondary }]}>
        Conversations appear here after you send your first message.
      </Text>
    </View>
  );
}

function SessionRow({
  active,
  onSelect,
  session,
}: {
  active: boolean;
  onSelect: () => void;
  session: PxiServerSessionSummary;
}) {
  const colors = useAppColors();

  return (
    <MotionPressable
      accessibilityLabel={`${sessionTitle(session)}, ${formatSessionDate(session.updatedAt)}`}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      haptic="selection"
      onPress={onSelect}
      scaleTo={0.99}
      style={[
        styles.sessionButton,
        { backgroundColor: active ? colors.backgroundSelected : colors.backgroundElement },
      ]}
    >
      <View style={styles.sessionCopy}>
        <Text numberOfLines={2} style={[styles.sessionTitle, { color: colors.text }]}>
          {sessionTitle(session)}
        </Text>
        <Text style={[styles.sessionMeta, { color: colors.textSecondary }]}>
          {formatSessionDate(session.updatedAt)}
        </Text>
      </View>
      <View style={styles.accessorySlot}>
        <SymbolView
          name={
            active
              ? { ios: 'checkmark', android: 'check', web: 'check' }
              : { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }
          }
          size={active ? 17 : 15}
          tintColor={active ? colors.brand : colors.textSecondary}
          weight="semibold"
        />
      </View>
    </MotionPressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  rail: { borderLeftWidth: StyleSheet.hairlineWidth, flex: 1 },
  railHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 64,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 8,
  },
  railHeadingGroup: { flex: 1, gap: 3, minWidth: 0 },
  railTitle: { fontFamily: AppFonts.semibold, fontSize: 17, letterSpacing: -0.2 },
  railSubtitle: { fontFamily: AppFonts.regular, fontSize: 12, lineHeight: 16 },
  railNewButton: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  railList: { flex: 1 },
  listContent: { paddingBottom: 1 },
  emptyList: { flexGrow: 1 },
  emptyState: {
    alignItems: 'center',
    flex: 1,
    gap: 9,
    justifyContent: 'center',
    minHeight: 250,
    padding: 28,
  },
  emptyGlyph: {
    alignItems: 'center',
    borderRadius: 22,
    height: 60,
    justifyContent: 'center',
    marginBottom: 4,
    width: 60,
  },
  emptyTitle: { fontFamily: AppFonts.semibold, fontSize: 20, textAlign: 'center' },
  emptyCopy: {
    fontFamily: AppFonts.regular,
    fontSize: 15,
    lineHeight: 21,
    maxWidth: 300,
    textAlign: 'center',
  },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 14 },
  sessionButton: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  sessionCopy: { flex: 1, gap: 5, minWidth: 0 },
  sessionTitle: { fontFamily: AppFonts.medium, fontSize: 15, lineHeight: 20 },
  sessionMeta: { fontFamily: AppFonts.regular, fontSize: 12 },
  accessorySlot: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    marginLeft: 10,
    width: 28,
  },
});

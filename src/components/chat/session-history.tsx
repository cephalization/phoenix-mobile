import { SymbolView } from 'expo-symbols';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { Extrapolation, interpolate, type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { ChatBottomSheet } from '@/components/chat/chat-bottom-sheet';
import { MotionPressable } from '@/components/motion-pressable';
import { PxiGlyph } from '@/components/pxi-glyph';
import { AppFonts, useAppColors } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { confirmAction } from '@/lib/confirm';
import type { PxiSessionSummary } from '@/lib/pxi-session-db';

function formatSessionDate(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  return isToday
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { day: 'numeric', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export function SessionHistory({
  activeSessionId,
  onClose,
  onDelete,
  onNew,
  onSelect,
  sessions,
  visible,
}: {
  activeSessionId: string | null;
  onClose: () => void;
  onDelete: (sessionId: string) => void;
  onNew: () => void;
  onSelect: (session: PxiSessionSummary) => void;
  sessions: PxiSessionSummary[];
  visible: boolean;
}) {
  const colors = useAppColors();

  const confirmDelete = (session: PxiSessionSummary) => {
    confirmAction({
      title: 'Delete chat?',
      message: 'This PXI conversation will be removed from this device.',
      confirmLabel: 'Delete',
      onConfirm: () => onDelete(session.id),
    });
  };

  return (
    <ChatBottomSheet onClose={onClose} subtitle="Stored locally on this device" title="Chat history" visible={visible}>
      <FlatList
        contentContainerStyle={[styles.listContent, sessions.length === 0 && styles.emptyList]}
        data={sessions}
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: colors.border }]} />}
        keyExtractor={(session) => session.id}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={[styles.emptyGlyph, { backgroundColor: colors.accentSoft }]}><PxiGlyph color={colors.brand} size={28} /></View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No saved chats</Text>
            <Text style={[styles.emptyCopy, { color: colors.textSecondary }]}>Conversations appear here after you send your first message.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <SessionRow
            active={item.id === activeSessionId}
            onDelete={() => confirmDelete(item)}
            onSelect={() => onSelect(item)}
            session={item}
          />
        )}
        style={[styles.list, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}
      />

      <View style={styles.footer}>
        <MotionPressable
          accessibilityRole="button"
          haptic="selection"
          onPress={onNew}
          style={[styles.newButton, { backgroundColor: colors.accent }]}>
          <SymbolView
            name={{ ios: 'plus', android: 'add', web: 'add' }}
            size={18}
            tintColor={colors.accentForeground}
            weight="medium"
          />
          <Text style={[styles.newButtonText, { color: colors.accentForeground }]}>New chat</Text>
        </MotionPressable>
      </View>
    </ChatBottomSheet>
  );
}

function SessionRow({
  active,
  onDelete,
  onSelect,
  session,
}: {
  active: boolean;
  onDelete: () => void;
  onSelect: () => void;
  session: PxiSessionSummary;
}) {
  const colors = useAppColors();
  return (
    <Swipeable
      childrenContainerStyle={{ backgroundColor: active ? colors.backgroundSelected : colors.backgroundElement }}
      friction={1.6}
      onSwipeableWillOpen={haptics.selection}
      overshootRight={false}
      renderRightActions={(progress, _translation, methods) => (
        <DeleteAction close={methods.close} onDelete={onDelete} progress={progress} />
      )}
      rightThreshold={42}>
      <MotionPressable
        accessibilityLabel={`${session.title}, ${formatSessionDate(session.updatedAt)}`}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        haptic="selection"
        onPress={onSelect}
        scaleTo={0.99}
        style={styles.sessionButton}>
        <View style={styles.sessionCopy}>
          <Text numberOfLines={2} style={[styles.sessionTitle, { color: colors.text }]}>{session.title}</Text>
          <Text style={[styles.sessionMeta, { color: colors.textSecondary }]}>{formatSessionDate(session.updatedAt)} · {session.messageCount} messages</Text>
        </View>
        <View style={styles.accessorySlot}>
          <SymbolView
            name={active
              ? { ios: 'checkmark', android: 'check', web: 'check' }
              : { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={active ? 17 : 15}
            tintColor={active ? colors.brand : colors.textSecondary}
            weight="semibold"
          />
        </View>
      </MotionPressable>
    </Swipeable>
  );
}

function DeleteAction({ close, onDelete, progress }: { close: () => void; onDelete: () => void; progress: SharedValue<number> }) {
  const colors = useAppColors();
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.5, 1], [0, 0.6, 1], Extrapolation.CLAMP),
    transform: [{ translateX: interpolate(progress.value, [0, 1], [28, 0], Extrapolation.CLAMP) }],
  }));
  return (
    <Animated.View style={[styles.deleteAction, { backgroundColor: colors.danger }, animatedStyle]}>
      <MotionPressable
        accessibilityLabel="Delete chat"
        accessibilityRole="button"
        haptic="warning"
        onPress={() => {
          close();
          onDelete();
        }}
        style={styles.deleteActionButton}>
        <Text style={styles.deleteActionText}>Delete</Text>
      </MotionPressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  list: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, marginTop: 12, overflow: 'hidden' },
  listContent: { paddingBottom: 1 },
  emptyList: { flexGrow: 1 },
  emptyState: { alignItems: 'center', flex: 1, gap: 9, justifyContent: 'center', minHeight: 250, padding: 28 },
  emptyGlyph: { alignItems: 'center', borderRadius: 22, height: 60, justifyContent: 'center', marginBottom: 4, width: 60 },
  emptyTitle: { fontFamily: AppFonts.semibold, fontSize: 20 },
  emptyCopy: { fontFamily: AppFonts.regular, fontSize: 15, lineHeight: 21, maxWidth: 300, textAlign: 'center' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 14 },
  sessionButton: { alignItems: 'center', flexDirection: 'row', minHeight: 72, paddingHorizontal: 14, paddingVertical: 11 },
  sessionCopy: { flex: 1, gap: 5, minWidth: 0 },
  sessionTitle: { fontFamily: AppFonts.medium, fontSize: 15, lineHeight: 20 },
  sessionMeta: { fontFamily: AppFonts.regular, fontSize: 12 },
  accessorySlot: { alignItems: 'center', height: 28, justifyContent: 'center', marginLeft: 10, width: 28 },
  deleteAction: { width: 86 },
  deleteActionButton: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 10 },
  deleteActionText: { color: '#FFFFFF', fontFamily: AppFonts.semibold, fontSize: 13 },
  footer: { paddingBottom: 4, paddingTop: 12 },
  newButton: { alignItems: 'center', borderRadius: 15, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 50 },
  newButtonText: { fontFamily: AppFonts.semibold, fontSize: 15 },
});

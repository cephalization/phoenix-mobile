import { SymbolView } from 'expo-symbols';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { ChatBottomSheet } from '@/components/chat/chat-bottom-sheet';
import { MotionPressable } from '@/components/motion-pressable';
import { PxiGlyph } from '@/components/pxi-glyph';
import { AppFonts, useAppColors } from '@/constants/theme';
import type { PxiServerSessionSummary } from '@/features/pxi/sessions';

function formatSessionDate(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  return isToday
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { day: 'numeric', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function sessionTitle(session: PxiServerSessionSummary): string {
  return session.title.trim() || 'Untitled chat';
}

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
    <ChatBottomSheet onClose={onClose} subtitle="Stored on this Phoenix instance" title="Chat history" visible={visible}>
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
            onSelect={() => onSelect(item)}
            session={item}
          />
        )}
        style={[styles.list, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}
      />
    </ChatBottomSheet>
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
      style={[styles.sessionButton, { backgroundColor: active ? colors.backgroundSelected : colors.backgroundElement }]}>
      <View style={styles.sessionCopy}>
        <Text numberOfLines={2} style={[styles.sessionTitle, { color: colors.text }]}>{sessionTitle(session)}</Text>
        <Text style={[styles.sessionMeta, { color: colors.textSecondary }]}>{formatSessionDate(session.updatedAt)}</Text>
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
  );
}

const styles = StyleSheet.create({
  list: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
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
});

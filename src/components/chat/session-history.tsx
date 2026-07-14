import { FlatList, Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MotionPressable } from '@/components/motion-pressable';
import { PxiGlyph } from '@/components/pxi-glyph';
import { AppFonts, Spacing, useAppColors } from '@/constants/theme';
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
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headingGroup}>
            <Text style={[styles.title, { color: colors.text }]}>Chat history</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Stored locally on this device</Text>
          </View>
          <MotionPressable accessibilityRole="button" onPress={onClose} style={[styles.closeButton, { backgroundColor: colors.backgroundSelected }]}>
            <Text style={[styles.closeText, { color: colors.text }]}>Close</Text>
          </MotionPressable>
        </View>

        <FlatList
          contentContainerStyle={[styles.list, sessions.length === 0 && styles.emptyList]}
          data={sessions}
          keyExtractor={(session) => session.id}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={[styles.emptyGlyph, { backgroundColor: colors.accentSoft }]}><PxiGlyph color={colors.brand} size={28} /></View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No saved chats</Text>
              <Text style={[styles.emptyCopy, { color: colors.textSecondary }]}>Conversations appear here after you send your first message.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isActive = item.id === activeSessionId;
            return (
              <View style={[styles.row, { backgroundColor: isActive ? colors.backgroundSelected : colors.backgroundElement, borderColor: isActive ? colors.accent : colors.border }]}>
                <MotionPressable
                  accessibilityLabel={`${item.title}, ${formatSessionDate(item.updatedAt)}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  haptic="selection"
                  onPress={() => onSelect(item)}
                  scaleTo={0.99}
                  style={styles.sessionButton}>
                  <View style={styles.sessionCopy}>
                    <Text numberOfLines={2} style={[styles.sessionTitle, { color: colors.text }]}>{item.title}</Text>
                    <Text style={[styles.sessionMeta, { color: colors.textSecondary }]}>{formatSessionDate(item.updatedAt)} · {item.messageCount} messages</Text>
                  </View>
                </MotionPressable>
                <MotionPressable
                  accessibilityLabel={`Delete ${item.title}`}
                  accessibilityRole="button"
                  haptic="warning"
                  onPress={() => confirmDelete(item)}
                  style={styles.deleteButton}>
                  <Text style={[styles.deleteText, { color: colors.danger }]}>Delete</Text>
                </MotionPressable>
              </View>
            );
          }}
        />

        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <MotionPressable accessibilityRole="button" onPress={onNew} style={[styles.newButton, { backgroundColor: colors.accent }]}>
            <Text style={[styles.newButtonText, { color: colors.accentForeground }]}>New chat</Text>
          </MotionPressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: Spacing.three, justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  headingGroup: { flex: 1, gap: 3 },
  title: { fontFamily: AppFonts.semibold, fontSize: 22, letterSpacing: -0.4 },
  subtitle: { fontFamily: AppFonts.regular, fontSize: 13 },
  closeButton: { borderRadius: 12, justifyContent: 'center', minHeight: 40, paddingHorizontal: 13 },
  closeText: { fontFamily: AppFonts.medium, fontSize: 14 },
  list: { gap: 9, padding: 16, paddingBottom: 24 },
  emptyList: { flexGrow: 1 },
  emptyState: { alignItems: 'center', flex: 1, gap: 10, justifyContent: 'center', padding: 28 },
  emptyGlyph: { alignItems: 'center', borderRadius: 22, height: 60, justifyContent: 'center', marginBottom: 4, width: 60 },
  emptyTitle: { fontFamily: AppFonts.semibold, fontSize: 20 },
  emptyCopy: { fontFamily: AppFonts.regular, fontSize: 15, lineHeight: 21, maxWidth: 300, textAlign: 'center' },
  row: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flexDirection: 'row', minHeight: 78, overflow: 'hidden' },
  sessionButton: { flex: 1, minHeight: 76, justifyContent: 'center', padding: 14 },
  sessionCopy: { gap: 6 },
  sessionTitle: { fontFamily: AppFonts.medium, fontSize: 15, lineHeight: 20 },
  sessionMeta: { fontFamily: AppFonts.regular, fontSize: 12 },
  deleteButton: { alignItems: 'center', alignSelf: 'stretch', justifyContent: 'center', minWidth: 72, paddingHorizontal: 10 },
  deleteText: { fontFamily: AppFonts.medium, fontSize: 12 },
  footer: { borderTopWidth: 1, padding: 16 },
  newButton: { alignItems: 'center', borderRadius: 15, justifyContent: 'center', minHeight: 50 },
  newButtonText: { fontFamily: AppFonts.semibold, fontSize: 15 },
});

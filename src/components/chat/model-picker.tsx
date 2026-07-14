import { FlatList, Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MotionPressable } from '@/components/motion-pressable';
import { AppFonts, Spacing, useAppColors } from '@/constants/theme';
import { isSameModel } from '@/features/pxi/model-catalog';
import type { ModelSelection, PxiModelOption } from '@/features/pxi/types';

export function ModelPicker({
  onClose,
  onSelect,
  options,
  selected,
  visible,
}: {
  onClose: () => void;
  onSelect: (model: ModelSelection) => void;
  options: PxiModelOption[];
  selected: ModelSelection;
  visible: boolean;
}) {
  const colors = useAppColors();

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headingGroup}>
            <Text style={[styles.title, { color: colors.text }]}>Choose a model</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Configured on this Phoenix instance</Text>
          </View>
          <MotionPressable
            accessibilityLabel="Close model picker"
            accessibilityRole="button"
            onPress={onClose}
            style={[styles.closeButton, { backgroundColor: colors.backgroundSelected }]}>
            <Text style={[styles.closeText, { color: colors.text }]}>Close</Text>
          </MotionPressable>
        </View>
        <FlatList
          contentContainerStyle={styles.list}
          data={options}
          keyExtractor={(option) => option.id}
          renderItem={({ item }) => {
            const isSelected = isSameModel(item.selection, selected);
            return (
              <MotionPressable
                accessibilityLabel={`${item.label}, ${item.providerLabel}`}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                haptic="selection"
                onPress={() => onSelect(item.selection)}
                scaleTo={0.99}
                style={[
                  styles.option,
                  {
                    backgroundColor: isSelected ? colors.backgroundSelected : colors.backgroundElement,
                    borderColor: isSelected ? colors.accent : colors.border,
                  },
                ]}>
                <View style={styles.optionCopy}>
                  <Text numberOfLines={1} style={[styles.modelName, { color: colors.text }]}>{item.label}</Text>
                  <Text numberOfLines={1} style={[styles.providerName, { color: colors.textSecondary }]}>
                    {item.providerLabel}{item.recommended ? ' · Recommended' : ''}
                  </Text>
                </View>
                <View
                  style={[
                    styles.selection,
                    { borderColor: isSelected ? colors.accent : colors.border },
                    isSelected && { backgroundColor: colors.accent },
                  ]}>
                  {isSelected && <View style={[styles.selectionDot, { backgroundColor: colors.accentForeground }]} />}
                </View>
              </MotionPressable>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: Spacing.three,
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headingGroup: { flex: 1, gap: 3 },
  title: { fontFamily: AppFonts.semibold, fontSize: 22, letterSpacing: -0.4 },
  subtitle: { fontFamily: AppFonts.regular, fontSize: 13 },
  closeButton: { borderRadius: 12, minHeight: 40, paddingHorizontal: 13, justifyContent: 'center' },
  closeText: { fontFamily: AppFonts.medium, fontSize: 14 },
  list: { gap: 8, padding: 16, paddingBottom: 32 },
  option: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 14, minHeight: 70, padding: 14 },
  optionCopy: { flex: 1, gap: 4 },
  modelName: { fontFamily: AppFonts.medium, fontSize: 15 },
  providerName: { fontFamily: AppFonts.regular, fontSize: 13 },
  selection: { alignItems: 'center', borderRadius: 10, borderWidth: 1.5, height: 20, justifyContent: 'center', width: 20 },
  selectionDot: { borderRadius: 3, height: 6, width: 6 },
});

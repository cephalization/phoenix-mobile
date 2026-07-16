import { SymbolView } from 'expo-symbols';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { ChatBottomSheet } from '@/components/chat/chat-bottom-sheet';
import { MotionPressable } from '@/components/motion-pressable';
import { AppFonts, useAppColors } from '@/constants/theme';
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
  const subtitle = options.length === 1
    ? '1 recommended model available'
    : `${options.length} recommended models available`;

  return (
    <ChatBottomSheet onClose={onClose} subtitle={subtitle} title="Choose a model" visible={visible}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={options}
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: colors.border }]} />}
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
              style={[styles.option, isSelected && { backgroundColor: colors.backgroundSelected }]}>
              <View style={styles.optionCopy}>
                <Text numberOfLines={1} style={[styles.modelName, { color: colors.text }]}>{item.label}</Text>
                <Text numberOfLines={1} style={[styles.providerName, { color: colors.textSecondary }]}>{item.providerLabel}</Text>
              </View>
              <View style={styles.selectionSlot}>
                {isSelected ? (
                  <SymbolView
                    name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                    size={18}
                    tintColor={colors.brand}
                    weight="semibold"
                  />
                ) : null}
              </View>
            </MotionPressable>
          );
        }}
        style={[styles.list, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}
      />
    </ChatBottomSheet>
  );
}

const styles = StyleSheet.create({
  list: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  listContent: { paddingBottom: 20 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 14 },
  option: { alignItems: 'center', flexDirection: 'row', gap: 11, minHeight: 62, paddingHorizontal: 14, paddingVertical: 9 },
  optionCopy: { flex: 1, gap: 2, minWidth: 0 },
  modelName: { fontFamily: AppFonts.medium, fontSize: 15 },
  providerName: { fontFamily: AppFonts.regular, fontSize: 12 },
  selectionSlot: { alignItems: 'center', height: 28, justifyContent: 'center', width: 28 },
});

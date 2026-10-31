import { SymbolView } from 'expo-symbols';
import { FlatList, StyleSheet } from 'react-native';

import { ChatBottomSheet } from '@/components/chat/chat-bottom-sheet';
import { ListRow, RowSeparator } from '@/components/ui/list-row';
import { useAppColors } from '@/constants/theme';
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
    <ChatBottomSheet flush onClose={onClose} title="Model" visible={visible}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={options}
        ItemSeparatorComponent={RowSeparator}
        keyExtractor={(option) => option.id}
        renderItem={({ item }) => {
          const isSelected = isSameModel(item.selection, selected);

          return (
            <ListRow
              accessibilityLabel={`${item.label}, ${item.providerLabel}${isSelected ? ', selected' : ''}`}
              onPress={() => onSelect(item.selection)}
              subtitle={item.providerLabel}
              title={item.label}
              trailing={
                isSelected ? (
                  <SymbolView
                    name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                    size={16}
                    tintColor={colors.text}
                    weight="semibold"
                  />
                ) : null
              }
              variant="flat"
            />
          );
        }}
      />
    </ChatBottomSheet>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 20 },
});

import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { FlatList, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';

import { ChatBottomSheet } from '@/components/chat/chat-bottom-sheet';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow, RowInset, RowSeparator } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { Type, useAppColors } from '@/constants/theme';
import {
  customModelOption,
  customModelProviderNote,
  type CustomModelOption,
  modelKey,
  rankModels,
  RecentModelsShown,
  resolveModelRow,
  selectionFor,
} from '@/features/pxi/model-search';
import type {
  ModelSelection,
  PxiModelCatalog,
  PxiModelRow,
  PxiProviderOption,
} from '@/features/pxi/types';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';

type PickerItem =
  | { kind: 'model'; key: string; row: PxiModelRow; showRecommended: boolean }
  | { kind: 'custom'; key: string; option: CustomModelOption };

type PickerSection = { key: string; title?: string; data: PickerItem[] };

const NoRecentModels: ModelSelection[] = [];

/**
 * The PXI model picker, after Phoenix's `AgentModelPicker`: a search field
 * over the catalog. With no query it lists the current model, recent picks,
 * and Phoenix's recommended models; a query ranks every provider's models and
 * ends with a row that sends the typed name to a provider of the user's choice.
 */
export function ModelPicker({
  catalog,
  instanceId,
  onClose,
  onSelect,
  selected,
  visible,
}: {
  catalog: PxiModelCatalog;
  instanceId: string;
  onClose: () => void;
  onSelect: (model: ModelSelection) => void;
  selected: ModelSelection | null;
  visible: boolean;
}) {
  const colors = useAppColors();

  const recentModels = useInstanceStore(
    (state) => state.pxiRecentModels[instanceId] ?? NoRecentModels,
  );

  const recordRecentPxiModel = useInstanceStore((state) => state.recordRecentPxiModel);
  const [query, setQuery] = useState('');
  const [customOption, setCustomOption] = useState<CustomModelOption | null>(null);

  const { providers, rows } = catalog;
  const currentRow = selected ? resolveModelRow({ model: selected, providers, rows }) : null;
  const recentModelKeys = recentModels.map(modelKey);

  // Recent rows resolve like the current row; drop the current one and any
  // that resolve to an earlier recent row.
  const recentRows = recentModels
    .map((model) => resolveModelRow({ model, providers, rows }))
    .filter(
      (row, index, all) =>
        row.key !== currentRow?.key && all.findIndex((other) => other.key === row.key) === index,
    )
    .slice(0, RecentModelsShown);

  const sections = pickerSections({
    catalog,
    currentRow,
    query,
    recentModelKeys,
    recentRows,
  });

  const reset = () => {
    setQuery('');
    setCustomOption(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const pick = (model: ModelSelection) => {
    recordRecentPxiModel(instanceId, model);
    reset();
    onSelect(model);
  };

  return (
    <ChatBottomSheet flush onClose={close} title="Model" visible={visible}>
      {customOption ? (
        <ProviderList
          onBack={() => setCustomOption(null)}
          onPick={(provider) => pick(selectionFor(provider, customOption.modelName))}
          option={customOption}
        />
      ) : (
        <>
          <View style={[styles.search, { backgroundColor: colors.backgroundSelected }]}>
            <SymbolView
              name={{ android: 'search', ios: 'magnifyingglass' }}
              size={15}
              tintColor={colors.textSecondary}
            />
            <TextInput
              accessibilityLabel="Search models"
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              onChangeText={setQuery}
              placeholder="Search, or type any model name"
              placeholderTextColor={colors.textSecondary}
              returnKeyType="search"
              spellCheck={false}
              style={[Type.body, styles.searchInput, { color: colors.text }]}
              value={query}
            />
          </View>
          {sections.length === 0 ? (
            query.trim() ? (
              <EmptyState
                symbol={{ android: 'search_off', ios: 'magnifyingglass' }}
                title="No models match"
              />
            ) : (
              <EmptyState
                message="Type a model name to search every provider, or to use your own."
                symbol={{ android: 'memory', ios: 'cpu' }}
                title="Search for a model"
              />
            )
          ) : (
            <SectionList
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={styles.listContent}
              ItemSeparatorComponent={RowSeparator}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              keyExtractor={(item) => item.key}
              renderItem={({ item }) =>
                item.kind === 'model' ? (
                  <ModelRow
                    checked={item.row.key === currentRow?.key}
                    onPress={() => pick(item.row.selection)}
                    row={item.row}
                    showRecommended={item.showRecommended}
                  />
                ) : (
                  <ListRow
                    accessibilityHint="Lists the providers this name can be sent to"
                    leading={
                      <SymbolView
                        name={{ android: 'edit', ios: 'pencil' }}
                        size={15}
                        tintColor={colors.textSecondary}
                      />
                    }
                    onPress={() => setCustomOption(item.option)}
                    subtitle="Choose a provider"
                    title={`Use “${item.option.modelName}” as a custom model`}
                    variant="flat"
                  />
                )
              }
              renderSectionHeader={({ section }) =>
                section.title ? <SectionHeader label={section.title} /> : null
              }
              sections={sections}
              stickySectionHeadersEnabled={false}
            />
          )}
        </>
      )}
    </ChatBottomSheet>
  );
}

/**
 * The picker's sections. An empty query lists Current (even when it isn't in
 * the catalog), Recent, and Recommended; a query lists the ranked results and
 * then the custom-model row.
 */
function pickerSections({
  catalog,
  currentRow,
  query,
  recentModelKeys,
  recentRows,
}: {
  catalog: PxiModelCatalog;
  currentRow: PxiModelRow | null;
  query: string;
  recentModelKeys: string[];
  recentRows: PxiModelRow[];
}): PickerSection[] {
  const modelItem = (section: string, row: PxiModelRow, showRecommended = false): PickerItem => ({
    kind: 'model',
    key: `${section}\u{E000}${row.key}`,
    row,
    showRecommended,
  });

  if (!query.trim()) {
    const sections: PickerSection[] = [
      {
        key: 'current',
        title: 'Current',
        data: currentRow ? [modelItem('current', currentRow)] : [],
      },
      { key: 'recent', title: 'Recent', data: recentRows.map((row) => modelItem('recent', row)) },
      {
        key: 'recommended',
        title: 'Recommended',
        data: catalog.recommended.map((row) => modelItem('recommended', row)),
      },
    ];

    return sections.filter((section) => section.data.length > 0);
  }

  const results = rankModels({ query, recentModelKeys, rows: catalog.rows });
  const custom = customModelOption(query, catalog.providers);

  const sections: PickerSection[] = [
    { key: 'results', data: results.map((row) => modelItem('results', row, true)) },
    { key: 'custom', data: custom ? [{ kind: 'custom', key: 'custom', option: custom }] : [] },
  ];

  return sections.filter((section) => section.data.length > 0);
}

function ModelRow({
  checked,
  onPress,
  row,
  showRecommended,
}: {
  checked: boolean;
  onPress: () => void;
  row: PxiModelRow;
  showRecommended: boolean;
}) {
  const title = row.displayName ?? row.modelName;
  const badge = credentialBadge(row);
  const recommended = showRecommended && row.isCurated && !badge;

  return (
    <ListRow
      accessibilityLabel={[title, row.providerName, badge?.label, recommended && 'Recommended']
        .filter(Boolean)
        .join(', ')}
      checked={checked}
      onPress={onPress}
      subtitle={row.providerName}
      title={title}
      trailing={
        badge ? (
          <Badge label={badge.label} tone={badge.tone} />
        ) : recommended ? (
          <Badge label="Recommended" tone="quiet" />
        ) : null
      }
      variant="flat"
    />
  );
}

/** “Unavailable” for a deleted custom provider, “Add key” for a missing key. */
function credentialBadge(
  row: Pick<PxiModelRow, 'credentialState' | 'isProviderMissing'>,
): { label: string; tone: 'danger' | 'quiet' } | null {
  if (row.isProviderMissing) return { label: 'Unavailable', tone: 'danger' };

  return row.credentialState === 'no-key' ? { label: 'Add key', tone: 'quiet' } : null;
}

function Badge({ label, tone }: { label: string; tone: 'danger' | 'quiet' }) {
  const colors = useAppColors();

  return (
    <Text
      importantForAccessibility="no"
      numberOfLines={1}
      style={[Type.label, { color: tone === 'danger' ? colors.danger : colors.textTertiary }]}
    >
      {label}
    </Text>
  );
}

/**
 * The providers a typed model name can be sent to: the one guessed from the
 * name first, then ready, may-work, and no-key providers.
 */
function ProviderList({
  onBack,
  onPick,
  option,
}: {
  onBack: () => void;
  onPick: (provider: PxiProviderOption) => void;
  option: CustomModelOption;
}) {
  const colors = useAppColors();

  return (
    <>
      <Pressable
        accessibilityLabel="Back to models"
        accessibilityRole="button"
        hitSlop={4}
        onPress={() => {
          haptics.selection();
          onBack();
        }}
        style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
      >
        <SymbolView
          name={{ android: 'arrow_back', ios: 'chevron.left' }}
          size={14}
          tintColor={colors.textSecondary}
          weight="semibold"
        />
        <Text style={[Type.body, { color: colors.textSecondary }]}>Models</Text>
      </Pressable>
      <SectionHeader label={`Providers for ${option.modelName}`} />
      <FlatList
        contentContainerStyle={styles.listContent}
        data={option.providers}
        ItemSeparatorComponent={RowSeparator}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(provider) => provider.key}
        renderItem={({ item }) => {
          const note = customModelProviderNote(item, item.key === option.guessedProviderKey);

          const badge = credentialBadge({
            credentialState: item.credentialState,
            isProviderMissing: false,
          });

          return (
            <ListRow
              accessibilityLabel={[item.name, note, badge?.label].filter(Boolean).join(', ')}
              onPress={() => onPick(item)}
              subtitle={note}
              title={item.name}
              trailing={badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
              variant="flat"
            />
          );
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  search: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
    marginHorizontal: 12,
    minHeight: 40,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, paddingVertical: 8 },
  back: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 6,
    minHeight: 48,
    paddingHorizontal: RowInset,
  },
  listContent: { paddingBottom: 20 },
});

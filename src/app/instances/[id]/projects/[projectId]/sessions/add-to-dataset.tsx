import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MotionPressable } from '@/components/motion-pressable';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow, RowInset, RowSeparator } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { AppFonts, Type, useAppColors } from '@/constants/theme';
import { formatRelativeTime } from '@/lib/format';
import { usePhoenixViewer } from '@/hooks/use-phoenix-data';
import {
  useAddPhoenixSessionToDataset,
  usePhoenixDatasets,
  usePhoenixSession,
  usePhoenixSessionTurns,
} from '@/hooks/use-phoenix-sessions';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';
import { useContentColumnStyle } from '@/features/duo/layout';

const NEW_DATASET = 'new';

export default function AddSessionToDatasetScreen() {
  const { id, projectId, sessionId } = useLocalSearchParams<{
    id: string;
    projectId: string;
    sessionId: string;
  }>();

  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  // Pads clear of iPhone Duo's vertical bar, which runs down a sheet's trailing edge.
  const column = useContentColumnStyle(0);
  const instance = useInstanceStore((state) => state.instances.find((item) => item.id === id));
  const session = usePhoenixSession(instance, projectId, sessionId);
  const turns = usePhoenixSessionTurns(instance, projectId, session.data);
  const datasets = usePhoenixDatasets(instance);
  const viewer = usePhoenixViewer(instance);
  const addToDataset = useAddPhoenixSessionToDataset(instance);
  const [selection, setSelection] = useState<string>(NEW_DATASET);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const readOnly =
    viewer.data != null && viewer.data.auth_method !== 'ANONYMOUS' && viewer.data.role === 'VIEWER';

  const eligibleTurns = (turns.data ?? []).filter((turn) => turn.rootSpan != null);
  const skippedCount = (turns.data?.length ?? 0) - eligibleTurns.length;

  const sortedDatasets = [...(datasets.data ?? [])].sort((left, right) =>
    right.updated_at.localeCompare(left.updated_at),
  );

  const loading = session.isPending || turns.isPending || datasets.isPending || viewer.isPending;
  const loadError = session.error ?? turns.error ?? datasets.error ?? viewer.error;
  const creating = selection === NEW_DATASET;

  const canSubmit =
    !loading &&
    !loadError &&
    !readOnly &&
    !addToDataset.isPending &&
    eligibleTurns.length > 0 &&
    (!creating || newName.trim().length > 0);

  if (!instance) {
    return (
      <ScrollView
        contentContainerStyle={styles.fill}
        contentInsetAdjustmentBehavior="automatic"
        style={[styles.screen, { backgroundColor: colors.background }]}
      >
        <EmptyState
          message="This Phoenix connection is no longer on this device."
          symbol={{ ios: 'questionmark.circle', android: 'help', web: 'help' }}
          title="Instance not found"
        />
      </ScrollView>
    );
  }

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);

    try {
      await addToDataset.mutateAsync({
        action: creating ? 'create' : 'append',
        datasetName: creating ? newName : selection,
        // The dataset writer trims and drops an empty description, so undefined equals omission.
        description: creating && newDescription.trim() ? newDescription : undefined,
        sessionId,
        turns: eligibleTurns,
      });
      haptics.success();

      if (router.canGoBack()) router.back();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : 'Phoenix could not add this session to the dataset.',
      );
      haptics.error();
    }
  };

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={[styles.content, column, { paddingBottom: 28 + insets.bottom }]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View style={styles.intro}>
        <Text style={[Type.subhead, { color: colors.textSecondary }]}>
          {eligibleTurns.length > 0
            ? `Adds ${eligibleTurns.length} turn${eligibleTurns.length === 1 ? '' : 's'} from this session as examples.`
            : 'Adds this session’s turns as examples.'}{' '}
          Each example links back to its source span.
        </Text>
        {skippedCount > 0 ? (
          <Text style={[Type.subhead, { color: colors.textTertiary }]}>
            {skippedCount} turn{skippedCount === 1 ? ' has' : 's have'} no root span and will be
            skipped.
          </Text>
        ) : null}
      </View>

      {loading ? (
        <EmptyState fill={false} loading title="Preparing this session" />
      ) : loadError ? (
        <EmptyState
          action={{
            label: 'Try again',
            onPress: () => {
              void session.refetch();
              void turns.refetch();
              void datasets.refetch();
              void viewer.refetch();
            },
          }}
          fill={false}
          message={loadError.message}
          symbol={{ ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' }}
          title="Couldn’t prepare this session"
        />
      ) : readOnly ? (
        <EmptyState
          fill={false}
          message="Your Phoenix Viewer role can browse datasets but cannot create them or add examples."
          symbol={{ ios: 'lock', android: 'lock', web: 'lock' }}
          title="Read-only access"
        />
      ) : eligibleTurns.length === 0 ? (
        <EmptyState
          fill={false}
          message="None of this session’s turns have a root span, so there is nothing to save as an example."
          symbol={{ ios: 'tray', android: 'inbox', web: 'inbox' }}
          title="No turns to add"
        />
      ) : (
        <>
          <View>
            <SectionHeader label="Dataset" />
            <ListRow
              accessibilityLabel={`New dataset${creating ? ', selected' : ''}`}
              leading={
                <SymbolView
                  name={{ ios: 'plus', android: 'add', web: 'add' }}
                  size={15}
                  tintColor={colors.text}
                  weight="semibold"
                />
              }
              onPress={() => setSelection(NEW_DATASET)}
              title="New dataset"
              trailing={creating ? <SelectedMark /> : null}
              variant="flat"
            />
            {creating ? (
              <View style={styles.newFields}>
                <TextInput
                  accessibilityLabel="New dataset name"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setNewName}
                  placeholder="Name"
                  placeholderTextColor={colors.textTertiary}
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.backgroundElement,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  value={newName}
                />
                <TextInput
                  accessibilityLabel="New dataset description"
                  onChangeText={setNewDescription}
                  placeholder="Description (optional)"
                  placeholderTextColor={colors.textTertiary}
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.backgroundElement,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  value={newDescription}
                />
              </View>
            ) : null}
            {sortedDatasets.map((dataset) => {
              const selected = !creating && selection === dataset.name;
              const count = `${dataset.example_count} example${dataset.example_count === 1 ? '' : 's'}`;

              return (
                <View key={dataset.id}>
                  <RowSeparator />
                  <ListRow
                    accessibilityLabel={`${dataset.name}, ${count}${selected ? ', selected' : ''}`}
                    meta={formatRelativeTime(dataset.updated_at)}
                    onPress={() => setSelection(dataset.name)}
                    subtitle={dataset.description ? `${count} · ${dataset.description}` : count}
                    title={dataset.name}
                    trailing={selected ? <SelectedMark /> : null}
                    variant="flat"
                  />
                </View>
              );
            })}
          </View>

          <View style={styles.actions}>
            {error ? (
              <Text accessibilityRole="alert" style={[Type.subhead, { color: colors.danger }]}>
                {error}
              </Text>
            ) : null}
            <MotionPressable
              accessibilityRole="button"
              accessibilityState={{ busy: addToDataset.isPending, disabled: !canSubmit }}
              disabled={!canSubmit}
              haptic="none"
              onPress={() => void submit()}
              style={[
                styles.submitButton,
                { backgroundColor: colors.accent, opacity: canSubmit ? 1 : 0.4 },
              ]}
            >
              <Text style={[styles.submitLabel, { color: colors.accentForeground }]}>
                {addToDataset.isPending
                  ? 'Adding…'
                  : `Add ${eligibleTurns.length} example${eligibleTurns.length === 1 ? '' : 's'}`}
              </Text>
            </MotionPressable>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function SelectedMark() {
  const colors = useAppColors();

  return (
    <SymbolView
      name={{ ios: 'checkmark', android: 'check', web: 'check' }}
      size={15}
      tintColor={colors.text}
      weight="semibold"
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fill: { flexGrow: 1 },
  content: { alignSelf: 'center', gap: 8, paddingTop: 12, width: '100%' },
  intro: { gap: 4, paddingHorizontal: RowInset },
  newFields: { gap: 8, paddingBottom: 12, paddingHorizontal: RowInset },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    fontFamily: AppFonts.regular,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  actions: { gap: 10, paddingHorizontal: RowInset, paddingTop: 16 },
  submitButton: {
    alignItems: 'center',
    borderRadius: 24,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 22,
  },
  submitLabel: { fontFamily: AppFonts.semibold, fontSize: 15 },
});

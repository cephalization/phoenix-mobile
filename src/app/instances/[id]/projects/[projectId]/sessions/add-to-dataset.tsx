import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MotionPressable } from '@/components/motion-pressable';
import { AppFonts, MaxContentWidth, useAppColors } from '@/constants/theme';
import type { DatasetSummary } from '@/features/session-review/types';
import { usePhoenixViewer } from '@/hooks/use-phoenix-data';
import {
  useAddPhoenixSessionToDataset,
  usePhoenixDatasets,
  usePhoenixSession,
  usePhoenixSessionTurns,
} from '@/hooks/use-phoenix-sessions';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';

const NEW_DATASET = 'new';

export default function AddSessionToDatasetScreen() {
  const { id, projectId, sessionId } = useLocalSearchParams<{
    id: string;
    projectId: string;
    sessionId: string;
  }>();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
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

  const readOnly = viewer.data != null
    && viewer.data.auth_method !== 'ANONYMOUS'
    && viewer.data.role === 'VIEWER';
  const eligibleTurns = (turns.data ?? []).filter((turn) => turn.rootSpan != null);
  const skippedCount = (turns.data?.length ?? 0) - eligibleTurns.length;
  const sortedDatasets = [...(datasets.data ?? [])].sort((left, right) =>
    right.updated_at.localeCompare(left.updated_at)
  );
  const loading = session.isPending || turns.isPending || datasets.isPending || viewer.isPending;
  const loadError = session.error ?? turns.error ?? datasets.error ?? viewer.error;
  const creating = selection === NEW_DATASET;
  const canSubmit = !loading
    && !loadError
    && !readOnly
    && !addToDataset.isPending
    && eligibleTurns.length > 0
    && (!creating || newName.trim().length > 0);

  if (!instance) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Add to dataset' }} />
        <Text style={[styles.copy, styles.centered, { color: colors.textSecondary }]}>
          This Phoenix connection is no longer on this device.
        </Text>
      </View>
    );
  }

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    try {
      await addToDataset.mutateAsync({
        action: creating ? 'create' : 'append',
        datasetName: creating ? newName : selection,
        ...(creating && newDescription.trim() ? { description: newDescription } : {}),
        sessionId,
        turns: eligibleTurns,
      });
      haptics.success();
      if (router.canGoBack()) router.back();
    } catch (submissionError) {
      setError(submissionError instanceof Error
        ? submissionError.message
        : 'Phoenix could not add this session to the dataset.');
      haptics.error();
    }
  };

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={[styles.content, { paddingBottom: 28 + insets.bottom }]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Add to dataset' }} />
      <View style={styles.intro}>
        <Text style={[styles.title, { color: colors.text }]}>Save as examples</Text>
        <Text style={[styles.copy, { color: colors.textSecondary }]}>
          Add {eligibleTurns.length > 0 ? `${eligibleTurns.length} turn${eligibleTurns.length === 1 ? '' : 's'} from this session` : 'this session'} to a Phoenix dataset for evals and experiments. Each example keeps a link back to its source span.
        </Text>
        {skippedCount > 0 ? (
          <Text style={[styles.skipNote, { color: colors.textSecondary }]}>
            {skippedCount} turn{skippedCount === 1 ? ' has' : 's have'} no root span and will be skipped.
          </Text>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : loadError ? (
        <StateCard
          action="Try again"
          message={loadError.message}
          onPress={() => {
            void session.refetch();
            void turns.refetch();
            void datasets.refetch();
            void viewer.refetch();
          }}
          title="Couldn’t prepare this session"
        />
      ) : readOnly ? (
        <StateCard
          message="Your Phoenix Viewer role can browse datasets but cannot create them or add examples."
          title="Read-only access"
        />
      ) : eligibleTurns.length === 0 ? (
        <StateCard
          message="None of this session’s turns have a root span, so there is nothing to save as an example."
          title="No turns to add"
        />
      ) : (
        <>
          <View style={[styles.optionList, { borderColor: colors.border }]}>
            <DatasetOption
              detail="Start a dataset with this session’s turns"
              divider={false}
              name="New dataset"
              onPress={() => setSelection(NEW_DATASET)}
              selected={creating}
            />
            {sortedDatasets.map((dataset) => (
              <DatasetOption
                dataset={dataset}
                divider
                key={dataset.id}
                name={dataset.name}
                onPress={() => setSelection(dataset.name)}
                selected={!creating && selection === dataset.name}
              />
            ))}
          </View>

          {creating ? (
            <View style={styles.newFields}>
              <TextInput
                accessibilityLabel="New dataset name"
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setNewName}
                placeholder="Dataset name"
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, { borderColor: colors.border, color: colors.text }]}
                value={newName}
              />
              <TextInput
                accessibilityLabel="New dataset description"
                onChangeText={setNewDescription}
                placeholder="Description (optional)"
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, { borderColor: colors.border, color: colors.text }]}
                value={newDescription}
              />
            </View>
          ) : null}

          {error ? (
            <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{error}</Text>
          ) : null}

          <MotionPressable
            accessibilityRole="button"
            disabled={!canSubmit}
            haptic="none"
            onPress={() => void submit()}
            style={[styles.submitButton, { backgroundColor: colors.accent, opacity: canSubmit ? 1 : 0.5 }]}>
            <Text style={[styles.submitLabel, { color: colors.accentForeground }]}>
              {addToDataset.isPending
                ? 'Adding...'
                : `Add ${eligibleTurns.length} example${eligibleTurns.length === 1 ? '' : 's'}`}
            </Text>
          </MotionPressable>
        </>
      )}
    </ScrollView>
  );
}

function DatasetOption({ dataset, detail, divider, name, onPress, selected }: {
  dataset?: DatasetSummary;
  detail?: string;
  divider: boolean;
  name: string;
  onPress: () => void;
  selected: boolean;
}) {
  const colors = useAppColors();
  const description = dataset
    ? `${dataset.example_count} example${dataset.example_count === 1 ? '' : 's'}${dataset.description ? ` · ${dataset.description}` : ''}`
    : detail;
  return (
    <MotionPressable
      accessibilityLabel={dataset ? `${name}, ${dataset.example_count} examples` : name}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      haptic={selected ? 'none' : 'selection'}
      onPress={onPress}
      style={[
        styles.optionRow,
        divider && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
      ]}>
      <View style={[styles.radio, { borderColor: selected ? colors.accent : colors.border }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: colors.accent }]} /> : null}
      </View>
      <View style={styles.optionCopy}>
        <Text numberOfLines={1} style={[styles.optionName, { color: colors.text }]}>{name}</Text>
        {description ? (
          <Text numberOfLines={2} style={[styles.optionDetail, { color: colors.textSecondary }]}>{description}</Text>
        ) : null}
      </View>
    </MotionPressable>
  );
}

function StateCard({ action, message, onPress, title }: {
  action?: string;
  message: string;
  onPress?: () => void;
  title: string;
}) {
  const colors = useAppColors();
  return (
    <View style={[styles.stateCard, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
      <Text style={[styles.stateTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.copy, { color: colors.textSecondary }]}>{message}</Text>
      {action && onPress ? (
        <MotionPressable accessibilityRole="button" onPress={onPress} style={[styles.secondaryButton, { borderColor: colors.border }]}>
          <Text style={[styles.secondaryLabel, { color: colors.text }]}>{action}</Text>
        </MotionPressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { alignSelf: 'center', gap: 18, maxWidth: MaxContentWidth, paddingHorizontal: 20, paddingTop: 18, width: '100%' },
  centered: { padding: 28, textAlign: 'center' },
  intro: { gap: 8 },
  title: { fontFamily: AppFonts.semibold, fontSize: 28, letterSpacing: -0.7 },
  copy: { fontFamily: AppFonts.regular, fontSize: 14, lineHeight: 21 },
  skipNote: { fontFamily: AppFonts.medium, fontSize: 12, lineHeight: 17 },
  loader: { paddingVertical: 48 },
  optionList: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  optionRow: { alignItems: 'center', flexDirection: 'row', gap: 14, minHeight: 64, paddingHorizontal: 16, paddingVertical: 12 },
  radio: { alignItems: 'center', borderRadius: 14, borderWidth: 1.5, height: 26, justifyContent: 'center', width: 26 },
  radioDot: { borderRadius: 7, height: 14, width: 14 },
  optionCopy: { flex: 1, gap: 3 },
  optionName: { fontFamily: AppFonts.semibold, fontSize: 15 },
  optionDetail: { fontFamily: AppFonts.regular, fontSize: 12, lineHeight: 17 },
  newFields: { gap: 10 },
  input: { borderRadius: 14, borderWidth: 1, fontFamily: AppFonts.regular, fontSize: 15, minHeight: 50, paddingHorizontal: 14 },
  error: { fontFamily: AppFonts.medium, fontSize: 13, lineHeight: 19 },
  submitButton: { alignItems: 'center', borderRadius: 16, justifyContent: 'center', minHeight: 52, paddingHorizontal: 22 },
  submitLabel: { fontFamily: AppFonts.semibold, fontSize: 15 },
  stateCard: { alignItems: 'flex-start', borderRadius: 18, borderWidth: 1, gap: 8, padding: 18 },
  stateTitle: { fontFamily: AppFonts.semibold, fontSize: 17 },
  secondaryButton: { borderRadius: 14, borderWidth: 1, justifyContent: 'center', marginTop: 5, minHeight: 48, paddingHorizontal: 16 },
  secondaryLabel: { fontFamily: AppFonts.semibold, fontSize: 14 },
});

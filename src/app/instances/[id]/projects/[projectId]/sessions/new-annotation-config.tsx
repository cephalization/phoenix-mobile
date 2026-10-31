import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MotionPressable } from '@/components/motion-pressable';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow, RowInset } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { AppFonts, Fonts, Type, useAppColors } from '@/constants/theme';
import type {
  AnnotationConfigOptimizationDirection,
  AnnotationConfigValueDraft,
} from '@/features/session-review/types';
import { usePhoenixViewer } from '@/hooks/use-phoenix-data';
import { useCreatePhoenixAnnotationConfig } from '@/hooks/use-phoenix-sessions';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';
import { useContentColumnStyle } from '@/features/duo/layout';

type ConfigType = 'CATEGORICAL' | 'CONTINUOUS' | 'FREEFORM';

type ValueRow = { id: number; label: string; score: string };

let valueRowSequence = 0;

function createValueRow(): ValueRow {
  valueRowSequence += 1;

  return { id: valueRowSequence, label: '', score: '' };
}

const CONFIG_TYPES: readonly { detail: string; label: string; value: ConfigType }[] = [
  { detail: 'Reviewers pick one label per session.', label: 'Categorical', value: 'CATEGORICAL' },
  { detail: 'Reviewers score within a numeric range.', label: 'Continuous', value: 'CONTINUOUS' },
  { detail: 'Reviewers write free-text feedback.', label: 'Freeform', value: 'FREEFORM' },
];

const DIRECTIONS: readonly { label: string; value: AnnotationConfigOptimizationDirection }[] = [
  { label: 'None', value: 'NONE' },
  { label: 'Maximize', value: 'MAXIMIZE' },
  { label: 'Minimize', value: 'MINIMIZE' },
];

const numericKeyboard = Platform.OS === 'ios' ? ('numbers-and-punctuation' as const) : undefined;

function parseNumberField(text: string): number | undefined {
  const trimmed = text.trim();

  return trimmed ? Number(trimmed) : undefined;
}

export default function NewAnnotationConfigScreen() {
  const { id, projectId } = useLocalSearchParams<{ id: string; projectId: string }>();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  // Pads clear of iPhone Duo's vertical bar, which runs down a sheet's trailing edge.
  const column = useContentColumnStyle(0);
  const instance = useInstanceStore((state) => state.instances.find((item) => item.id === id));
  const viewer = usePhoenixViewer(instance);
  const createConfig = useCreatePhoenixAnnotationConfig(instance, projectId);
  const [type, setType] = useState<ConfigType>('CATEGORICAL');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [direction, setDirection] = useState<AnnotationConfigOptimizationDirection>('NONE');
  const [values, setValues] = useState<ValueRow[]>(() => [createValueRow()]);
  const [lowerBound, setLowerBound] = useState('');
  const [upperBound, setUpperBound] = useState('');
  const [error, setError] = useState<string | null>(null);

  const readOnly =
    viewer.data != null && viewer.data.auth_method !== 'ANONYMOUS' && viewer.data.role === 'VIEWER';

  const canSubmit =
    !viewer.isPending &&
    !readOnly &&
    !createConfig.isPending &&
    name.trim().length > 0 &&
    (type !== 'CATEGORICAL' || values.some((value) => value.label.trim()));

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

  const updateValue = (index: number, patch: Partial<ValueRow>) => {
    setValues((current) =>
      current.map((value, position) => (position === index ? { ...value, ...patch } : value)),
    );
  };

  const removeValue = (index: number) => {
    haptics.selection();
    setValues((current) => current.filter((_value, position) => position !== index));
  };

  // ListRow gives the selection haptic.
  const addValue = () => {
    setValues((current) => [...current, createValueRow()]);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);

    try {
      await createConfig.mutateAsync({
        name,
        // The config writer trims and drops an empty description, so undefined equals omission.
        description: description.trim() ? description : undefined,
        draft:
          type === 'CATEGORICAL'
            ? {
                type,
                optimizationDirection: direction,
                values: values
                  .filter((value) => value.label.trim() || value.score.trim())
                  .map((value) => {
                    const draftValue: AnnotationConfigValueDraft = { label: value.label };
                    const score = parseNumberField(value.score);

                    if (score != null) draftValue.score = score;

                    return draftValue;
                  }),
              }
            : type === 'CONTINUOUS'
              ? {
                  type,
                  optimizationDirection: direction,
                  lowerBound: parseNumberField(lowerBound),
                  upperBound: parseNumberField(upperBound),
                }
              : { type },
      });
      haptics.success();

      if (router.canGoBack()) router.back();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : 'Phoenix could not create the annotation configuration.',
      );
      haptics.error();
    }
  };

  const inputColors = {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.border,
    color: colors.text,
  };

  const typeDetail = CONFIG_TYPES.find((option) => option.value === type)?.detail;

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={[styles.content, column, { paddingBottom: 28 + insets.bottom }]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <Text style={[Type.subhead, styles.inset, { color: colors.textSecondary }]}>
        Creates a rating on this server and assigns it to this project, so its sessions can be
        reviewed with it.
      </Text>

      {viewer.isPending ? (
        <EmptyState fill={false} loading title="Checking your access" />
      ) : readOnly ? (
        <EmptyState
          fill={false}
          message="Your Phoenix Viewer role can browse annotation configurations but cannot create them."
          symbol={{ ios: 'lock', android: 'lock', web: 'lock' }}
          title="Read-only access"
        />
      ) : (
        <>
          <SectionHeader label="Type" />
          <View style={[styles.inset, styles.group]}>
            <SegmentedControl onChange={setType} options={CONFIG_TYPES} value={type} />
            {typeDetail ? (
              <Text style={[Type.subhead, { color: colors.textTertiary }]}>{typeDetail}</Text>
            ) : null}
          </View>

          <SectionHeader label="Details" />
          <View style={[styles.inset, styles.group]}>
            <TextInput
              accessibilityLabel="Configuration name"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setName}
              placeholder="Name, such as helpfulness"
              placeholderTextColor={colors.textTertiary}
              style={[styles.input, inputColors]}
              value={name}
            />
            <TextInput
              accessibilityLabel="Configuration description"
              onChangeText={setDescription}
              placeholder="Description (optional)"
              placeholderTextColor={colors.textTertiary}
              style={[styles.input, inputColors]}
              value={description}
            />
          </View>

          {type === 'CATEGORICAL' ? (
            <>
              <SectionHeader label="Values" />
              <View style={[styles.inset, styles.group]}>
                {values.map((value, index) => (
                  <View key={value.id} style={styles.valueRow}>
                    <TextInput
                      accessibilityLabel={`Label for value ${index + 1}`}
                      autoCapitalize="none"
                      autoCorrect={false}
                      onChangeText={(label) => updateValue(index, { label })}
                      placeholder="Label"
                      placeholderTextColor={colors.textTertiary}
                      style={[styles.input, styles.valueLabel, inputColors]}
                      value={value.label}
                    />
                    <TextInput
                      accessibilityLabel={`Score for value ${index + 1}`}
                      keyboardType={numericKeyboard}
                      onChangeText={(score) => updateValue(index, { score })}
                      placeholder="Score"
                      placeholderTextColor={colors.textTertiary}
                      style={[styles.input, styles.numberInput, styles.valueScore, inputColors]}
                      value={value.score}
                    />
                    {values.length > 1 ? (
                      <MotionPressable
                        accessibilityLabel={`Remove value ${index + 1}`}
                        accessibilityRole="button"
                        onPress={() => removeValue(index)}
                        style={styles.removeValue}
                      >
                        <SymbolView
                          name={{
                            ios: 'minus.circle',
                            android: 'remove_circle_outline',
                            web: 'remove_circle_outline',
                          }}
                          size={18}
                          tintColor={colors.textTertiary}
                        />
                      </MotionPressable>
                    ) : null}
                  </View>
                ))}
              </View>
              <ListRow
                leading={
                  <SymbolView
                    name={{ ios: 'plus', android: 'add', web: 'add' }}
                    size={15}
                    tintColor={colors.text}
                    weight="semibold"
                  />
                }
                onPress={addValue}
                title="Add value"
                variant="flat"
              />
            </>
          ) : null}

          {type === 'CONTINUOUS' ? (
            <>
              <SectionHeader label="Range" />
              <View style={[styles.inset, styles.valueRow]}>
                <TextInput
                  accessibilityLabel="Minimum score"
                  keyboardType={numericKeyboard}
                  onChangeText={setLowerBound}
                  placeholder="Min (optional)"
                  placeholderTextColor={colors.textTertiary}
                  style={[styles.input, styles.numberInput, styles.valueLabel, inputColors]}
                  value={lowerBound}
                />
                <TextInput
                  accessibilityLabel="Maximum score"
                  keyboardType={numericKeyboard}
                  onChangeText={setUpperBound}
                  placeholder="Max (optional)"
                  placeholderTextColor={colors.textTertiary}
                  style={[styles.input, styles.numberInput, styles.valueLabel, inputColors]}
                  value={upperBound}
                />
              </View>
            </>
          ) : null}

          {type !== 'FREEFORM' ? (
            <>
              <SectionHeader label="Optimize" />
              <View style={styles.inset}>
                <SegmentedControl onChange={setDirection} options={DIRECTIONS} value={direction} />
              </View>
            </>
          ) : null}

          <View style={[styles.inset, styles.actions]}>
            {error ? (
              <Text accessibilityRole="alert" style={[Type.subhead, { color: colors.danger }]}>
                {error}
              </Text>
            ) : null}
            <MotionPressable
              accessibilityRole="button"
              accessibilityState={{ busy: createConfig.isPending, disabled: !canSubmit }}
              disabled={!canSubmit}
              haptic="none"
              onPress={() => void submit()}
              style={[
                styles.submitButton,
                { backgroundColor: colors.accent, opacity: canSubmit ? 1 : 0.4 },
              ]}
            >
              <Text style={[styles.submitLabel, { color: colors.accentForeground }]}>
                {createConfig.isPending ? 'Creating…' : 'Create configuration'}
              </Text>
            </MotionPressable>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fill: { flexGrow: 1 },
  content: { alignSelf: 'center', gap: 4, paddingTop: 12, width: '100%' },
  inset: { paddingHorizontal: RowInset },
  group: { gap: 8, paddingVertical: 6 },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    fontFamily: AppFonts.regular,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  numberInput: { fontFamily: Fonts.mono, fontSize: 15 },
  valueRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  valueLabel: { flex: 1.6 },
  valueScore: { flex: 1 },
  removeValue: { alignItems: 'center', height: 48, justifyContent: 'center', width: 40 },
  actions: { gap: 10, paddingTop: 20 },
  submitButton: {
    alignItems: 'center',
    borderRadius: 24,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 22,
  },
  submitLabel: { fontFamily: AppFonts.semibold, fontSize: 15 },
});

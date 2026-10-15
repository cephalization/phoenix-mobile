import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MotionPressable } from '@/components/motion-pressable';
import { AppFonts, MaxContentWidth, useAppColors } from '@/constants/theme';
import type {
  AnnotationConfigOptimizationDirection,
  AnnotationConfigValueDraft,
} from '@/features/session-review/types';
import { usePhoenixViewer } from '@/hooks/use-phoenix-data';
import { useCreatePhoenixAnnotationConfig } from '@/hooks/use-phoenix-sessions';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';

type ConfigType = 'CATEGORICAL' | 'CONTINUOUS' | 'FREEFORM';

type ValueRow = { id: number; label: string; score: string };

let valueRowSequence = 0;

function createValueRow(): ValueRow {
  valueRowSequence += 1;

  return { id: valueRowSequence, label: '', score: '' };
}

const CONFIG_TYPES: { detail: string; label: string; type: ConfigType }[] = [
  { detail: 'Pick one label per session', label: 'Categorical', type: 'CATEGORICAL' },
  { detail: 'Score within a numeric range', label: 'Continuous', type: 'CONTINUOUS' },
  { detail: 'Write free-text feedback', label: 'Freeform', type: 'FREEFORM' },
];

const DIRECTIONS: { label: string; value: AnnotationConfigOptimizationDirection }[] = [
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
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'New annotation config' }} />
        <Text style={[styles.copy, styles.centered, { color: colors.textSecondary }]}>
          This Phoenix connection is no longer on this device.
        </Text>
      </View>
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

  const addValue = () => {
    haptics.selection();
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

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={[styles.content, { paddingBottom: 28 + insets.bottom }]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <Stack.Screen options={{ title: 'New annotation config' }} />
      <View style={styles.intro}>
        <Text style={[styles.title, { color: colors.text }]}>Define a rating</Text>
        <Text style={[styles.copy, { color: colors.textSecondary }]}>
          Create an annotation configuration on this server and assign it to this project so
          sessions can be reviewed with it.
        </Text>
      </View>

      {viewer.isPending ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : readOnly ? (
        <View
          style={[
            styles.stateCard,
            { backgroundColor: colors.backgroundElement, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.stateTitle, { color: colors.text }]}>Read-only access</Text>
          <Text style={[styles.copy, { color: colors.textSecondary }]}>
            Your Phoenix Viewer role can browse annotation configurations but cannot create them.
          </Text>
        </View>
      ) : (
        <>
          <View style={[styles.optionList, { borderColor: colors.border }]}>
            {CONFIG_TYPES.map((option, index) => {
              const selected = type === option.type;

              return (
                <MotionPressable
                  accessibilityLabel={`${option.label} annotation type`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  haptic={selected ? 'none' : 'selection'}
                  key={option.type}
                  onPress={() => setType(option.type)}
                  style={[
                    styles.optionRow,
                    index > 0 && {
                      borderTopColor: colors.border,
                      borderTopWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.radio,
                      { borderColor: selected ? colors.accent : colors.border },
                    ]}
                  >
                    {selected ? (
                      <View style={[styles.radioDot, { backgroundColor: colors.accent }]} />
                    ) : null}
                  </View>
                  <View style={styles.optionCopy}>
                    <Text style={[styles.optionName, { color: colors.text }]}>{option.label}</Text>
                    <Text style={[styles.optionDetail, { color: colors.textSecondary }]}>
                      {option.detail}
                    </Text>
                  </View>
                </MotionPressable>
              );
            })}
          </View>

          <View style={styles.fields}>
            <TextInput
              accessibilityLabel="Configuration name"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setName}
              placeholder="Name, e.g. helpfulness"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, { borderColor: colors.border, color: colors.text }]}
              value={name}
            />
            <TextInput
              accessibilityLabel="Configuration description"
              onChangeText={setDescription}
              placeholder="Description (optional)"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, { borderColor: colors.border, color: colors.text }]}
              value={description}
            />
          </View>

          {type === 'CATEGORICAL' ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Values</Text>
              {values.map((value, index) => (
                <View key={value.id} style={styles.valueRow}>
                  <TextInput
                    accessibilityLabel={`Label for value ${index + 1}`}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={(label) => updateValue(index, { label })}
                    placeholder="Label"
                    placeholderTextColor={colors.textSecondary}
                    style={[
                      styles.input,
                      styles.valueLabel,
                      { borderColor: colors.border, color: colors.text },
                    ]}
                    value={value.label}
                  />
                  <TextInput
                    accessibilityLabel={`Score for value ${index + 1}`}
                    keyboardType={numericKeyboard}
                    onChangeText={(score) => updateValue(index, { score })}
                    placeholder="Score"
                    placeholderTextColor={colors.textSecondary}
                    style={[
                      styles.input,
                      styles.valueScore,
                      { borderColor: colors.border, color: colors.text },
                    ]}
                    value={value.score}
                  />
                  {values.length > 1 ? (
                    <MotionPressable
                      accessibilityLabel={`Remove value ${index + 1}`}
                      accessibilityRole="button"
                      onPress={() => removeValue(index)}
                      style={styles.removeValue}
                    >
                      <Text style={[styles.removeGlyph, { color: colors.textSecondary }]}>✕</Text>
                    </MotionPressable>
                  ) : null}
                </View>
              ))}
              <MotionPressable
                accessibilityRole="button"
                onPress={addValue}
                style={[styles.secondaryButton, { borderColor: colors.border }]}
              >
                <Text style={[styles.secondaryLabel, { color: colors.text }]}>Add value</Text>
              </MotionPressable>
            </View>
          ) : null}

          {type === 'CONTINUOUS' ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Range</Text>
              <View style={styles.valueRow}>
                <TextInput
                  accessibilityLabel="Minimum score"
                  keyboardType={numericKeyboard}
                  onChangeText={setLowerBound}
                  placeholder="Min (optional)"
                  placeholderTextColor={colors.textSecondary}
                  style={[
                    styles.input,
                    styles.valueLabel,
                    { borderColor: colors.border, color: colors.text },
                  ]}
                  value={lowerBound}
                />
                <TextInput
                  accessibilityLabel="Maximum score"
                  keyboardType={numericKeyboard}
                  onChangeText={setUpperBound}
                  placeholder="Max (optional)"
                  placeholderTextColor={colors.textSecondary}
                  style={[
                    styles.input,
                    styles.valueLabel,
                    { borderColor: colors.border, color: colors.text },
                  ]}
                  value={upperBound}
                />
              </View>
            </View>
          ) : null}

          {type !== 'FREEFORM' ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Optimize</Text>
              <View style={styles.chipRow}>
                {DIRECTIONS.map((option) => {
                  const selected = direction === option.value;

                  return (
                    <MotionPressable
                      accessibilityLabel={`Optimization ${option.label}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      haptic={selected ? 'none' : 'selection'}
                      key={option.value}
                      onPress={() => setDirection(option.value)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: selected ? colors.accent : 'transparent',
                          borderColor: selected ? colors.accent : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipLabel,
                          { color: selected ? colors.accentForeground : colors.text },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </MotionPressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {error ? (
            <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>
              {error}
            </Text>
          ) : null}

          <MotionPressable
            accessibilityRole="button"
            disabled={!canSubmit}
            haptic="none"
            onPress={() => void submit()}
            style={[
              styles.submitButton,
              { backgroundColor: colors.accent, opacity: canSubmit ? 1 : 0.5 },
            ]}
          >
            <Text style={[styles.submitLabel, { color: colors.accentForeground }]}>
              {createConfig.isPending ? 'Creating...' : 'Create configuration'}
            </Text>
          </MotionPressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    alignSelf: 'center',
    gap: 18,
    maxWidth: MaxContentWidth,
    paddingHorizontal: 20,
    paddingTop: 18,
    width: '100%',
  },
  centered: { padding: 28, textAlign: 'center' },
  intro: { gap: 8 },
  title: { fontFamily: AppFonts.semibold, fontSize: 28, letterSpacing: -0.7 },
  copy: { fontFamily: AppFonts.regular, fontSize: 14, lineHeight: 21 },
  loader: { paddingVertical: 48 },
  optionList: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  optionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    minHeight: 60,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  radio: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  radioDot: { borderRadius: 7, height: 14, width: 14 },
  optionCopy: { flex: 1, gap: 2 },
  optionName: { fontFamily: AppFonts.semibold, fontSize: 15 },
  optionDetail: { fontFamily: AppFonts.regular, fontSize: 12, lineHeight: 17 },
  fields: { gap: 10 },
  section: { gap: 10 },
  sectionTitle: { fontFamily: AppFonts.semibold, fontSize: 15 },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontFamily: AppFonts.regular,
    fontSize: 15,
    minHeight: 50,
    paddingHorizontal: 14,
  },
  valueRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  valueLabel: { flex: 1.6 },
  valueScore: { flex: 1 },
  removeValue: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  removeGlyph: { fontFamily: AppFonts.semibold, fontSize: 16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 18,
  },
  chipLabel: { fontFamily: AppFonts.semibold, fontSize: 14 },
  error: { fontFamily: AppFonts.medium, fontSize: 13, lineHeight: 19 },
  submitButton: {
    alignItems: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 22,
  },
  submitLabel: { fontFamily: AppFonts.semibold, fontSize: 15 },
  stateCard: { alignItems: 'flex-start', borderRadius: 18, borderWidth: 1, gap: 8, padding: 18 },
  stateTitle: { fontFamily: AppFonts.semibold, fontSize: 17 },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  secondaryLabel: { fontFamily: AppFonts.semibold, fontSize: 14 },
});

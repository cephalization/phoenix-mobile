import { useEffect, useRef, useState } from 'react';
import {
  type AccessibilityValue,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputInstance,
  View,
} from 'react-native';

import { ChatBottomSheet } from '@/components/chat/chat-bottom-sheet';
import { MotionPressable } from '@/components/motion-pressable';
import { ScoreSlider } from '@/components/score-slider';
import { StatusLabel } from '@/components/ui/status-label';
import { AppFonts, Type, useAppColors } from '@/constants/theme';
import type {
  ContinuousAnnotationConfig,
  SessionAnnotationConfig,
  SessionAnnotationDraft,
} from '@/features/session-review/types';

export type ReviewValue = {
  explanation: string;
  value: string;
};

export const EMPTY_REVIEW_VALUE: ReviewValue = { explanation: '', value: '' };

/** One annotation config's field: its name, description, and input. */
export function ReviewControl({
  complete,
  config,
  disabled,
  onChange,
  value,
}: {
  /** The session already holds a valid annotation for this config. */
  complete: boolean;
  config: SessionAnnotationConfig;
  disabled: boolean;
  onChange: (field: keyof ReviewValue, value: string) => void;
  value: ReviewValue;
}) {
  const colors = useAppColors();
  const [explainVisible, setExplainVisible] = useState(false);
  const explained = value.explanation.trim().length > 0;

  return (
    <View style={styles.field}>
      <View style={styles.fieldHeader}>
        <View style={styles.fieldTitle}>
          <Text style={[Type.headline, styles.fieldName, { color: colors.text }]}>
            {config.name}
          </Text>
          {complete ? <StatusLabel label="Complete" tone="ok" /> : null}
        </View>
        {config.type !== 'FREEFORM' ? (
          <Pressable
            accessibilityHint="Opens a sheet to write an optional explanation for this annotation"
            accessibilityLabel={
              explained ? `Edit the ${config.name} explanation` : `Explain the ${config.name} value`
            }
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => setExplainVisible(true)}
            style={({ pressed }) => [styles.textButton, (pressed || disabled) && styles.receded]}
          >
            <Text style={[styles.textButtonLabel, { color: colors.text }]}>
              {explained ? 'Edit note' : 'Explain'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {config.description ? (
        <Text style={[Type.subhead, { color: colors.textSecondary }]}>{config.description}</Text>
      ) : null}
      {config.type === 'CATEGORICAL' ? (
        <View accessibilityRole="radiogroup" style={styles.choices}>
          {config.values.map((option) => {
            const selected = value.value === option.label;

            return (
              <MotionPressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled }}
                disabled={disabled}
                haptic={selected ? 'none' : 'selection'}
                key={option.label}
                onPress={() => onChange('value', option.label)}
                style={[
                  styles.choice,
                  { backgroundColor: selected ? colors.accent : colors.backgroundSelected },
                  disabled && styles.receded,
                ]}
              >
                <Text
                  style={[
                    styles.choiceLabel,
                    { color: selected ? colors.accentForeground : colors.text },
                  ]}
                >
                  {option.label}
                </Text>
              </MotionPressable>
            );
          })}
        </View>
      ) : config.type === 'CONTINUOUS' ? (
        <ContinuousInput config={config} disabled={disabled} onChange={onChange} value={value} />
      ) : (
        <TextInput
          accessibilityLabel={`${config.name} review`}
          editable={!disabled}
          multiline
          onChangeText={(text) => onChange('value', text)}
          placeholder="Write a review"
          placeholderTextColor={colors.textTertiary}
          style={[styles.textArea, { borderColor: colors.border, color: colors.text }]}
          textAlignVertical="top"
          value={value.value}
        />
      )}
      {config.type !== 'FREEFORM' && explained ? (
        <Text
          numberOfLines={2}
          style={[
            Type.subhead,
            styles.quote,
            { borderLeftColor: colors.border, color: colors.textSecondary },
          ]}
        >
          {value.explanation}
        </Text>
      ) : null}
      {config.type !== 'FREEFORM' && explainVisible ? (
        <ExplanationSheet
          configName={config.name}
          onChange={(text) => onChange('explanation', text)}
          onClose={() => setExplainVisible(false)}
          value={value.explanation}
        />
      ) : null}
    </View>
  );
}

function ContinuousInput({
  config,
  disabled,
  onChange,
  value,
}: {
  config: ContinuousAnnotationConfig;
  disabled: boolean;
  onChange: (field: keyof ReviewValue, value: string) => void;
  value: ReviewValue;
}) {
  const colors = useAppColors();
  const range = finiteRange(config);
  const numericValue = Number(value.value);
  const scored = value.value.trim().length > 0 && Number.isFinite(numericValue);

  const accessibilityValue: AccessibilityValue = {
    max: range?.upper,
    min: range?.lower,
    now: scored ? numericValue : undefined,
    text: value.value || 'No score entered',
  };

  return (
    <>
      <TextInput
        accessibilityHint={
          range ? `Enter a value from ${range.lower} to ${range.upper}.` : 'Enter a numeric score.'
        }
        accessibilityLabel={`${config.name} score`}
        accessibilityValue={accessibilityValue}
        editable={!disabled}
        inputMode="decimal"
        onChangeText={(text) => onChange('value', text)}
        placeholder={continuousPlaceholder(config)}
        placeholderTextColor={colors.textTertiary}
        style={[
          Type.monoValue,
          styles.numberInput,
          { borderColor: colors.border, color: colors.text },
        ]}
        value={value.value}
      />
      {range ? (
        <View>
          <ScoreSlider
            disabled={disabled}
            max={range.upper}
            min={range.lower}
            onValueChange={(next) =>
              onChange('value', formatSliderValue(next, range.lower, range.upper))
            }
            step={sliderStep(range.lower, range.upper)}
            value={
              scored ? Math.min(range.upper, Math.max(range.lower, numericValue)) : range.lower
            }
          />
          <View style={styles.bounds}>
            <Text style={[Type.mono, { color: colors.textTertiary }]}>{range.lower}</Text>
            {!scored ? (
              <Text style={[Type.label, { color: colors.textTertiary }]}>Not scored yet</Text>
            ) : null}
            <Text style={[Type.mono, { color: colors.textTertiary }]}>{range.upper}</Text>
          </View>
        </View>
      ) : null}
    </>
  );
}

function ExplanationSheet({
  configName,
  onChange,
  onClose,
  value,
}: {
  configName: string;
  onChange: (text: string) => void;
  onClose: () => void;
  value: string;
}) {
  const colors = useAppColors();
  const inputRef = useRef<TextInputInstance>(null);

  // autoFocus inside the native bottom sheet places the cursor without raising
  // the Android keyboard, so re-focus after the sheet has presented.
  useEffect(() => {
    const timeout = setTimeout(() => {
      inputRef.current?.blur();
      inputRef.current?.focus();
    }, 350);

    return () => clearTimeout(timeout);
  }, []);

  return (
    <ChatBottomSheet
      onClose={onClose}
      // 'full' presents at max height on both platforms, so the keyboard never
      // clips the Done button; fractions resolve to 'half' on Android.
      snapPoints={['full']}
      subtitle="Optional context saved with this annotation."
      title={`Explain ${configName}`}
      visible
    >
      <View style={styles.sheetBody}>
        <TextInput
          accessibilityLabel={`${configName} explanation`}
          autoFocus
          multiline
          ref={inputRef}
          onChangeText={onChange}
          placeholder="Why did you choose this value?"
          placeholderTextColor={colors.textTertiary}
          style={[
            styles.textArea,
            styles.sheetInput,
            { borderColor: colors.border, color: colors.text },
          ]}
          textAlignVertical="top"
          value={value}
        />
        <MotionPressable
          accessibilityRole="button"
          onPress={onClose}
          style={[styles.done, { backgroundColor: colors.accent }]}
        >
          <Text style={[styles.doneLabel, { color: colors.accentForeground }]}>Done</Text>
        </MotionPressable>
      </View>
    </ChatBottomSheet>
  );
}

/** Builds the annotation to write, or throws a message the form shows as is. */
export function draftForConfig(
  config: SessionAnnotationConfig,
  value: ReviewValue | undefined,
): SessionAnnotationDraft {
  if (config.type === 'CATEGORICAL') {
    if (!value?.value) throw new Error(`Select a value for ${config.name}.`);

    return { type: 'CATEGORICAL', label: value.value, explanation: value.explanation };
  }

  if (config.type === 'CONTINUOUS') {
    if (!value?.value.trim()) throw new Error(`Enter a score for ${config.name}.`);
    const score = Number(value.value);

    if (!Number.isFinite(score)) throw new Error(`${config.name} must be a finite number.`);

    if (config.lower_bound != null && score < config.lower_bound)
      throw new Error(`${config.name} must be at least ${config.lower_bound}.`);

    if (config.upper_bound != null && score > config.upper_bound)
      throw new Error(`${config.name} must be at most ${config.upper_bound}.`);

    return { type: 'CONTINUOUS', score, explanation: value.explanation };
  }

  if (!value?.value.trim()) throw new Error(`Enter a review for ${config.name}.`);

  return { type: 'FREEFORM', explanation: value.value };
}

function finiteRange(config: ContinuousAnnotationConfig): { lower: number; upper: number } | null {
  const lower = config.lower_bound;
  const upper = config.upper_bound;

  if (lower == null || upper == null) return null;

  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) return null;

  return { lower, upper };
}

function continuousPlaceholder(config: ContinuousAnnotationConfig) {
  if (config.lower_bound != null && config.upper_bound != null)
    return `${config.lower_bound} to ${config.upper_bound}`;

  if (config.lower_bound != null) return `${config.lower_bound} or greater`;

  if (config.upper_bound != null) return `${config.upper_bound} or less`;

  return 'Enter a number';
}

function sliderStep(lower: number, upper: number) {
  const range = upper - lower;

  if (Number.isInteger(lower) && Number.isInteger(upper) && range <= 100) return 1;

  return range / 100;
}

function formatSliderValue(value: number, lower: number, upper: number) {
  if (Number.isInteger(lower) && Number.isInteger(upper) && upper - lower <= 100)
    return String(Math.round(value));

  return String(Number(value.toFixed(3)));
}

const styles = StyleSheet.create({
  field: { gap: 10, paddingVertical: 16 },
  fieldHeader: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 32 },
  fieldTitle: { alignItems: 'center', flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  fieldName: { flexShrink: 1 },
  textButton: { justifyContent: 'center', minHeight: 48, minWidth: 48, paddingLeft: 8 },
  textButtonLabel: { fontFamily: AppFonts.medium, fontSize: 14 },
  receded: { opacity: 0.45 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    alignItems: 'center',
    borderRadius: 18,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 64,
    paddingHorizontal: 16,
  },
  choiceLabel: { fontFamily: AppFonts.medium, fontSize: 14 },
  numberInput: { borderRadius: 12, borderWidth: 1, minHeight: 48, paddingHorizontal: 14 },
  bounds: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  quote: { borderLeftWidth: 2, paddingLeft: 10 },
  textArea: {
    ...Type.body,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 104,
    padding: 12,
  },
  sheetBody: { gap: 12 },
  sheetInput: { maxHeight: 260, minHeight: 150 },
  done: { alignItems: 'center', borderRadius: 24, justifyContent: 'center', minHeight: 48 },
  doneLabel: { fontFamily: AppFonts.semibold, fontSize: 15 },
});

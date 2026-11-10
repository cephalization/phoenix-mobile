import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import { MotionPressable } from '@/components/motion-pressable';
import { RowInset } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { StatusLabel } from '@/components/ui/status-label';
import { AppFonts, Fonts, Type, useAppColors } from '@/constants/theme';
import type { TraceFilterVocabularyTerm } from '@/features/traces/filter';
import {
  generateTraceFilter,
  type TraceFilterGenerationPhase,
  type TraceFilterVerdict,
} from '@/features/traces/filter-ai';
import { validateTraceFilterCondition } from '@/features/traces/filter-api';
import type { TraceFilterAssistant } from '@/features/traces/filter-models';
import { haptics } from '@/lib/haptics';
import type { PhoenixInstance } from '@/types/instance';

export type TraceFilterAskStatus =
  | { phase: 'idle' }
  | { phase: 'running'; step: TraceFilterGenerationPhase }
  | { phase: 'done'; expression: string; verdict: TraceFilterVerdict | null }
  | { phase: 'failed'; message: string };

/**
 * Ask's state: the plain-language request and one generation at a time. A new
 * request, Cancel, or leaving the sheet abandons the one in flight.
 */
export function useTraceFilterAsk({
  assistant,
  instance,
  projectId,
  vocabulary,
}: {
  assistant: TraceFilterAssistant | null;
  instance: PhoenixInstance | undefined;
  projectId: string;
  vocabulary: readonly TraceFilterVocabularyTerm[];
}) {
  const [request, setRequest] = useState('');
  const [status, setStatus] = useState<TraceFilterAskStatus>({ phase: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const cancel = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStatus({ phase: 'idle' });
  };

  const generate = async () => {
    const query = request.trim();

    if (!assistant || !instance || query.length === 0) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus({ phase: 'running', step: 'generating' });

    try {
      const result = await generateTraceFilter({
        model: assistant.model,
        query,
        vocabulary,
        signal: controller.signal,
        onPhase: (step) => {
          if (!controller.signal.aborted) setStatus({ phase: 'running', step });
        },
        validate: (expression) =>
          validateTraceFilterCondition(instance, projectId, expression, controller.signal),
      });

      if (controller.signal.aborted) return;
      setStatus({ phase: 'done', ...result });

      if (result.verdict?.isValid === false) haptics.error();
      else haptics.success();
    } catch (error) {
      if (controller.signal.aborted) return;
      haptics.error();
      setStatus({
        phase: 'failed',
        message: error instanceof Error ? error.message : 'The model could not write a filter.',
      });
    }
  };

  /** The generated expression when it can be applied: valid, or unjudged by an older server. */
  const applicable =
    status.phase === 'done' && status.verdict?.isValid !== false ? status.expression : null;

  return { applicable, cancel, generate, request, setRequest, status };
}

const StepLabels: Record<TraceFilterGenerationPhase, string> = {
  generating: 'Writing a filter…',
  validating: 'Checking it with Phoenix…',
  repairing: 'Fixing what Phoenix rejected…',
};

/** The Ask page of the filter sheet: plain language in, a checked expression out. */
export function TraceFilterAsk({
  ask,
  assistant,
  onEdit,
  onUse,
}: {
  ask: ReturnType<typeof useTraceFilterAsk>;
  assistant: TraceFilterAssistant;
  onEdit: (expression: string) => void;
  onUse: (expression: string) => void;
}) {
  const colors = useAppColors();
  const { status } = ask;
  const running = status.phase === 'running';
  const canGenerate = ask.request.trim().length > 0 && !running;

  return (
    <View>
      <View style={styles.inputRow}>
        <TextInput
          accessibilityLabel="Describe the traces to show"
          multiline
          onChangeText={ask.setRequest}
          onSubmitEditing={() => void ask.generate()}
          placeholder="Slow traces where a tool call failed"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="go"
          style={[
            styles.input,
            {
              backgroundColor: colors.backgroundElement,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
          submitBehavior="blurAndSubmit"
          value={ask.request}
        />
        <View style={styles.footer}>
          <View accessible style={styles.backend}>
            <SymbolView
              name={
                assistant.kind === 'onDevice'
                  ? { android: 'memory', ios: 'cpu' }
                  : { android: 'dns', ios: 'server.rack' }
              }
              size={12}
              tintColor={colors.textTertiary}
            />
            <Text
              numberOfLines={1}
              style={[Type.label, styles.backendLabel, { color: colors.textTertiary }]}
            >
              {assistant.label}
            </Text>
          </View>
          <MotionPressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canGenerate && !running }}
            disabled={!canGenerate && !running}
            haptic="selection"
            onPress={() => (running ? ask.cancel() : void ask.generate())}
            style={[
              styles.button,
              { borderColor: colors.border, opacity: canGenerate || running ? 1 : 0.4 },
            ]}
          >
            <Text style={[styles.buttonLabel, { color: colors.text }]}>
              {running ? 'Cancel' : 'Generate'}
            </Text>
          </MotionPressable>
        </View>
      </View>

      {status.phase === 'running' ? (
        <View accessibilityLiveRegion="polite" style={styles.progress}>
          <ActivityIndicator color={colors.textSecondary} />
          <Text style={[Type.subhead, { color: colors.textSecondary }]}>
            {StepLabels[status.step]}
          </Text>
        </View>
      ) : status.phase === 'failed' ? (
        <View accessibilityLiveRegion="polite" style={styles.result}>
          <StatusLabel label="Couldn’t write a filter" tone="error" />
          <Text selectable style={[Type.subhead, { color: colors.textSecondary }]}>
            {status.message}
          </Text>
        </View>
      ) : status.phase === 'done' ? (
        <View>
          <SectionHeader label="Filter" />
          <View accessibilityLiveRegion="polite" style={styles.result}>
            <Text selectable style={[styles.expression, { color: colors.text }]}>
              {status.expression}
            </Text>
            {status.verdict === null ? (
              <StatusLabel label="Phoenix checks it when applied" tone="neutral" />
            ) : status.verdict.isValid ? (
              <StatusLabel label="Valid filter" tone="ok" />
            ) : (
              <>
                <StatusLabel label="Phoenix rejected it" tone="error" />
                {status.verdict.errorMessage ? (
                  <Text selectable style={[Type.subhead, { color: colors.textSecondary }]}>
                    {status.verdict.errorMessage}
                  </Text>
                ) : null}
              </>
            )}
            {status.verdict?.warnings.map((warning) => (
              <Text key={warning} style={[Type.subhead, { color: colors.textSecondary }]}>
                {warning}
              </Text>
            ))}
            <View style={styles.actions}>
              {ask.applicable !== null ? (
                <ResultButton label="Use filter" onPress={() => onUse(status.expression)} />
              ) : null}
              <ResultButton label="Edit" onPress={() => onEdit(status.expression)} />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ResultButton({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useAppColors();

  return (
    <MotionPressable
      accessibilityRole="button"
      haptic="selection"
      onPress={onPress}
      style={[styles.button, { borderColor: colors.border }]}
    >
      <Text style={[styles.buttonLabel, { color: colors.text }]}>{label}</Text>
    </MotionPressable>
  );
}

const styles = StyleSheet.create({
  inputRow: { gap: 10, paddingHorizontal: RowInset, paddingTop: 12 },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    fontFamily: AppFonts.regular,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 72,
    paddingBottom: 12,
    paddingHorizontal: 14,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  footer: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  backend: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 6, minWidth: 0 },
  backendLabel: { flexShrink: 1 },
  button: {
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 96,
    paddingHorizontal: 20,
  },
  buttonLabel: { fontFamily: AppFonts.semibold, fontSize: 15 },
  progress: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: RowInset,
    paddingTop: 20,
  },
  result: { gap: 8, paddingHorizontal: RowInset, paddingTop: 4 },
  expression: { fontFamily: Fonts.mono, fontSize: 15, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: 10, paddingTop: 8 },
});

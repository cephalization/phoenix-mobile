import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, type TextInputInstance, View } from 'react-native';

import { ListRow, RowInset, RowSeparator } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { StatusLabel } from '@/components/ui/status-label';
import { Fonts, Type, useAppColors } from '@/constants/theme';
import {
  CoreTraceFilterTerms,
  expandSnippet,
  replaceRange,
  snippetText,
  straightenQuotes,
  type TextEdit,
  type TextSelection,
  TraceFilterSnippets,
  tokenAtCursor,
  traceFilterCompletions,
  type TraceFilterVocabularyTerm,
} from '@/features/traces/filter';
import type { TraceFilterValidation } from '@/hooks/use-phoenix-data';
import { haptics } from '@/lib/haptics';

/** Phoenix's browse cut (`MAX_BROWSE_SUGGESTIONS`): the rest wait behind "All suggestions". */
const BrowseSuggestionCount = 5;

/**
 * The Expression page of the filter sheet: a monospaced field, its server
 * validation, and below it either recent filters and suggestions (while
 * empty) or completions for the field name being typed.
 */
export function TraceFilterEditor({
  draft,
  onChangeDraft,
  onSubmit,
  recent,
  validation,
  vocabulary,
}: {
  draft: string;
  onChangeDraft: (draft: string) => void;
  /** Return on the keyboard; the sheet applies when the draft is applicable. */
  onSubmit: () => void;
  recent: readonly string[];
  validation: TraceFilterValidation;
  vocabulary: readonly TraceFilterVocabularyTerm[];
}) {
  const colors = useAppColors();
  const inputRef = useRef<TextInputInstance>(null);

  const [selection, setSelection] = useState<TextSelection>({
    start: draft.length,
    end: draft.length,
  });

  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const empty = draft.trim().length === 0;

  const token =
    !empty && selection.start === selection.end ? tokenAtCursor(draft, selection.end) : null;

  const completions = token
    ? traceFilterCompletions(
        vocabulary.length > 0 ? vocabulary : CoreTraceFilterTerms,
        token.prefix,
      )
    : [];

  // Writes an edit and selects its first placeholder once the input has the new text.
  const write = (edit: TextEdit) => {
    onChangeDraft(edit.text);
    setSelection(edit.selection);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelection(edit.selection.start, edit.selection.end);
    });
  };

  const suggestions = showAllSuggestions
    ? TraceFilterSnippets
    : TraceFilterSnippets.slice(0, BrowseSuggestionCount);

  return (
    <View>
      <View style={styles.inputRow}>
        <TextInput
          accessibilityHint="A Python-like condition evaluated against each trace"
          accessibilityLabel="Filter expression"
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect={false}
          // `ascii-capable` keeps iOS from offering curly quotes; any that
          // slip through (a paste, a hardware keyboard) are straightened.
          keyboardType="ascii-capable"
          multiline
          onChangeText={(text) => onChangeDraft(straightenQuotes(text))}
          onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
          onSubmitEditing={onSubmit}
          placeholder="latency_ms > 1000"
          placeholderTextColor={colors.textTertiary}
          ref={inputRef}
          returnKeyType="done"
          smartInsertDelete={false}
          spellCheck={false}
          style={[
            styles.input,
            {
              backgroundColor: colors.backgroundElement,
              borderColor: validation.state === 'invalid' ? colors.danger : colors.border,
              color: colors.text,
            },
          ]}
          submitBehavior="blurAndSubmit"
          textContentType="none"
          value={draft}
        />
        <ValidationLine validation={validation} />
      </View>

      {empty ? (
        <>
          {recent.length > 0 ? (
            <View>
              <SectionHeader label="Recent" />
              {recent.map((expression, index) => (
                <View key={expression}>
                  {index > 0 ? <RowSeparator /> : null}
                  <ExpressionRow
                    accessibilityHint="Puts this filter in the field"
                    expression={expression}
                    onPress={() =>
                      write({
                        text: expression,
                        selection: { start: expression.length, end: expression.length },
                      })
                    }
                  />
                </View>
              ))}
            </View>
          ) : null}
          <SectionHeader label="Suggestions" />
          {suggestions.map((suggestion, index) => (
            <View key={suggestion.label}>
              {index > 0 ? <RowSeparator /> : null}
              <ExpressionRow
                accessibilityHint="Puts this filter in the field and selects the part to change"
                expression={snippetText(suggestion.snippet)}
                label={suggestion.label}
                onPress={() => write(expandSnippet(suggestion.snippet))}
              />
            </View>
          ))}
          {showAllSuggestions ? null : (
            <>
              <RowSeparator />
              <ListRow
                accessibilityHint="Lists every suggested filter"
                onPress={() => setShowAllSuggestions(true)}
                title={`All suggestions (${TraceFilterSnippets.length})`}
                variant="flat"
              />
            </>
          )}
        </>
      ) : completions.length > 0 && token ? (
        <View>
          <SectionHeader label="Fields" />
          {completions.map((completion, index) => (
            <View key={completion.label}>
              {index > 0 ? <RowSeparator /> : null}
              <Pressable
                accessibilityHint="Replaces the word being typed"
                accessibilityLabel={`${completion.label}, ${completion.detail}`}
                accessibilityRole="button"
                android_ripple={{ color: colors.ripple }}
                onPress={() => {
                  haptics.selection();
                  write(replaceRange(draft, token.range, completion.insert));
                }}
                style={({ pressed }) => [
                  styles.row,
                  pressed && { backgroundColor: colors.rowSelected },
                ]}
              >
                <View style={styles.fieldLine}>
                  <Text
                    numberOfLines={1}
                    style={[styles.expression, styles.fieldName, { color: colors.text }]}
                  >
                    {completion.label}
                  </Text>
                  <Text style={[Type.mono, { color: colors.textTertiary }]}>
                    {completion.detail}
                  </Text>
                </View>
                {completion.description ? (
                  <Text numberOfLines={1} style={[Type.subhead, { color: colors.textSecondary }]}>
                    {completion.description}
                  </Text>
                ) : null}
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The validator's verdict under the field, at a fixed height so the lists below stay put. */
function ValidationLine({ validation }: { validation: TraceFilterValidation }) {
  const colors = useAppColors();

  return (
    <View accessibilityLiveRegion="polite" style={styles.validation}>
      {validation.state === 'idle' ? (
        <Text style={[Type.subhead, { color: colors.textTertiary }]}>
          A condition each trace must meet. Strings take single quotes.
        </Text>
      ) : validation.state === 'checking' ? (
        <StatusLabel label="Checking" tone="pending" />
      ) : validation.state === 'valid' ? (
        <StatusLabel label="Valid filter" tone="ok" />
      ) : validation.state === 'invalid' ? (
        <StatusLabel label="Not a valid filter" tone="error" />
      ) : (
        <StatusLabel label="Phoenix checks it when applied" tone="neutral" />
      )}
      {validation.message ? (
        <Text selectable style={[Type.subhead, { color: colors.textSecondary }]}>
          {validation.message}
        </Text>
      ) : null}
      {validation.warnings.map((warning) => (
        <Text key={warning} style={[Type.subhead, { color: colors.textSecondary }]}>
          {warning}
        </Text>
      ))}
    </View>
  );
}

/** A filter as a flat row: an optional label over the expression in monospace. */
function ExpressionRow({
  accessibilityHint,
  expression,
  label,
  onPress,
}: {
  accessibilityHint: string;
  expression: string;
  label?: string;
  onPress: () => void;
}) {
  const colors = useAppColors();

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label ? `${label}: ${expression}` : expression}
      accessibilityRole="button"
      android_ripple={{ color: colors.ripple }}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.rowSelected }]}
    >
      {label ? (
        <Text numberOfLines={1} style={[Type.body, { color: colors.text }]}>
          {label}
        </Text>
      ) : null}
      <Text
        numberOfLines={2}
        style={[styles.expression, { color: label ? colors.textSecondary : colors.text }]}
      >
        {expression}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  inputRow: { gap: 8, paddingHorizontal: RowInset, paddingTop: 12 },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    fontFamily: Fonts.mono,
    fontSize: 15,
    lineHeight: 21,
    minHeight: 96,
    paddingBottom: 12,
    paddingHorizontal: 14,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  validation: { gap: 4, minHeight: 20 },
  row: {
    gap: 3,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: RowInset,
    paddingVertical: 10,
  },
  expression: { fontFamily: Fonts.mono, fontSize: 13, lineHeight: 18 },
  fieldLine: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  fieldName: { flex: 1 },
});

/**
 * Pure helpers for the trace filter DSL: combining conditions, the suggested
 * snippets ported from Phoenix's `traceFilterSnippets`, placeholder expansion,
 * and field completion for the identifier under the cursor.
 */

/** One bindable term of the trace filter DSL, as `Project.traceFilterVocabulary` serves it. */
export type TraceFilterVocabularyTerm = {
  name: string;
  type: string;
  description: string;
  category: string;
  iterableName: string | null;
};

export type TextSelection = { start: number; end: number };

/** Text after an edit, with the range the input should select (or the caret, when empty). */
export type TextEdit = { text: string; selection: TextSelection };

/**
 * AND-combines trace conditions for the REST `filter` parameter. Each part is
 * parenthesized so an `or` inside one cannot capture its neighbour; a single
 * condition goes through untouched.
 */
export function combineTraceFilters(parts: readonly (string | null | undefined)[]) {
  const conditions = parts.flatMap((part) => {
    const condition = part?.trim() ?? '';

    return condition.length > 0 ? [condition] : [];
  });

  if (conditions.length === 0) return undefined;

  if (conditions.length === 1) return conditions[0];

  return conditions.map((condition) => `(${condition})`).join(' and ');
}

/**
 * iOS smart punctuation turns typed quotes into curly ones, which the DSL
 * rejects. Straighten them as the user types.
 */
export function straightenQuotes(text: string) {
  return text.replace(/[‘’‚‛′]/g, "'").replace(/[“”„‟″]/g, '"');
}

/** Normalizes an expression for applying and remembering: straight quotes, one line, trimmed. */
export function normalizeTraceFilter(text: string) {
  return straightenQuotes(text)
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

export const RecentTraceFilterLimit = 8;

/** Puts `expression` first in a recent list, without duplicates, capped at `limit`. */
export function rememberTraceFilter(
  recent: readonly string[],
  expression: string,
  limit = RecentTraceFilterLimit,
) {
  const normalized = normalizeTraceFilter(expression);

  if (normalized.length === 0) return [...recent];

  return [normalized, ...recent.filter((item) => item !== normalized)].slice(0, limit);
}

export type TraceFilterSnippet = { label: string; snippet: string };

/**
 * Phoenix's suggested trace filters (`traceFilterSnippets` in
 * `js/app/src/pages/project/traceFilterDSL.ts`). `${…}` marks text the user
 * is expected to replace; its contents are the default.
 */
export const TraceFilterSnippets: readonly TraceFilterSnippet[] = [
  {
    label: 'Search input and output for text',
    snippet: "'${search text}' in input or '${search text}' in output",
  },
  { label: 'Filter by number of spans', snippet: 'num_spans >= ${5}' },
  { label: 'Any span errored', snippet: 'any(span.status_code == "ERROR" for span in spans)' },
  {
    label: 'Slowest span in the trace',
    snippet: 'max(span.latency_ms for span in spans) > ${5_000}',
  },
  {
    label: 'Any span has an errored child',
    snippet: 'any(any(child.status_code == "ERROR" for child in span.children) for span in spans)',
  },
  {
    label: 'Direct child of the trace root',
    snippet:
      'any(span.parent_span is not None and span.parent_span.parent_id is None for span in spans)',
  },
  {
    label: 'Combine trace and span conditions',
    snippet: 'num_spans >= ${5} and any(span.status_code == "ERROR" for span in spans)',
  },
  { label: 'Filter by errors', snippet: 'error_count > 0' },
  { label: 'Filter by duration', snippet: 'latency_ms >= ${10_000}' },
  { label: 'Filter by trace ID', snippet: "trace_id == '${trace id}'" },
  { label: 'Filter by total tokens', snippet: 'token_count_total > ${1_000}' },
  { label: 'Filter by total cost', snippet: 'total_cost > ${1}' },
  { label: 'Filter by tool usage', snippet: 'tool_span_count > 0' },
  { label: 'Filter by user', snippet: "user.id == '${user id}'" },
  { label: 'Filter by metadata', snippet: 'metadata["${key}"] == \'${value}\'' },
  { label: 'Filter by annotation score', snippet: 'trace_annotations["${name}"].score >= ${0.5}' },
  {
    label: 'Filter by annotation label',
    snippet: 'trace_annotations["${name}"].label == \'${label}\'',
  },
  { label: 'Search input for text', snippet: "'${search text}' in input" },
  { label: 'Search output for text', snippet: "'${search text}' in output" },
  {
    label: 'Any span matches a condition',
    snippet: 'any(${span.latency_ms > 1000} for span in ${spans})',
  },
  {
    label: 'All spans match a condition',
    snippet:
      'len([span for span in ${spans}]) > 0 and all(${span.latency_ms < 1000} for span in ${spans})',
  },
  {
    label: 'Count spans matching a condition',
    snippet: 'len([span for span in spans if span.span_kind == "${TOOL}"]) >= ${2}',
  },
];

const PlaceholderPattern = /\$\{([^{}]*)\}/g;

/** A snippet as plain text, with its placeholders replaced by their defaults. */
export function snippetText(snippet: string) {
  return snippet.replace(PlaceholderPattern, '$1');
}

/**
 * Expands a snippet's placeholders to their defaults and selects the first
 * one, so typing replaces it. Without placeholders the caret goes to the end.
 */
export function expandSnippet(snippet: string): TextEdit {
  const first = /\$\{([^{}]*)\}/.exec(snippet);
  const text = snippetText(snippet);

  if (!first) return { text, selection: { start: text.length, end: text.length } };

  const start = snippetText(snippet.slice(0, first.index)).length;

  return { text, selection: { start, end: start + first[1].length } };
}

const IdentifierCharacter = /[A-Za-z0-9_.]/;

/**
 * The identifier being typed at `cursor`: its range (which a completion
 * replaces) and the part before the caret (which completions match). Null
 * inside a string literal or when the caret is not touching an identifier.
 */
export function tokenAtCursor(
  text: string,
  cursor: number,
): { prefix: string; range: TextSelection } | null {
  const caret = Math.max(0, Math.min(cursor, text.length));

  if (insideStringLiteral(text, caret)) return null;

  let start = caret;

  while (start > 0 && IdentifierCharacter.test(text[start - 1])) start -= 1;

  let end = caret;

  while (end < text.length && IdentifierCharacter.test(text[end])) end += 1;

  const prefix = text.slice(start, caret);

  // A number such as `1_000` is a value, not a field.
  if (prefix.length === 0 || /^[0-9]/.test(prefix)) return null;

  return { prefix, range: { start, end } };
}

function insideStringLiteral(text: string, caret: number) {
  let quote: string | null = null;

  for (let index = 0; index < caret; index += 1) {
    const character = text[index];

    if (quote !== null) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
    } else if (character === "'" || character === '"') {
      quote = character;
    }
  }

  return quote !== null;
}

export type TraceFilterCompletion = {
  /** What the row shows, in the form it is written. */
  label: string;
  /** Value type: string, number, datetime, boolean, iterable, relation, containment. */
  detail: string;
  description: string;
  /** Inserted in place of the token; `${…}` placeholders are expanded and the first selected. */
  insert: string;
};

const LoopVariables = new Map([
  ['spans', 'span'],
  ['trace_annotations', 'annotation'],
  ['span_annotations', 'annotation'],
  ['span_cost_details', 'cost_detail'],
]);

/** The loop variable Phoenix writes for a collection: `span` for `spans`. */
export function loopVariable(iterableName: string) {
  return (
    LoopVariables.get(iterableName) ??
    (iterableName.endsWith('s') ? iterableName.slice(0, -1) : 'item')
  );
}

const ExamplePredicates = new Map([
  ['spans', 'span.latency_ms > 1_000'],
  ['trace_annotations', 'annotation.score < 0.5'],
  ['span_annotations', 'annotation.score < 0.5'],
  ['span_cost_details', 'cost_detail.tokens > 1_000'],
]);

/** The writable form of a vocabulary term, with any placeholder it needs. */
export function completionForTerm(term: TraceFilterVocabularyTerm): TraceFilterCompletion {
  const element = term.iterableName ? `${loopVariable(term.iterableName)}.${term.name}` : null;
  const label = element ?? term.name;
  let insert = label;

  if (term.name === 'attributes[...]') {
    insert = 'attributes["${key}"]';
  } else if (term.name === 'metadata["key"]') {
    insert = 'metadata["${key}"]';
  } else if (!term.iterableName && term.type === 'iterable') {
    // A bare collection never validates, so a collection inserts a whole
    // comprehension with an editable example predicate.
    const predicate = ExamplePredicates.get(term.name) ?? 'condition';

    insert = `any(\${${predicate}} for ${loopVariable(term.name)} in ${term.name})`;
  }

  return {
    label: term.name === 'attributes[...]' ? 'attributes["key"]' : label,
    detail: term.type,
    description: term.description,
    insert,
  };
}

/**
 * The trace fields every Phoenix with trace filters understands, for
 * completion while the project's vocabulary loads or on servers without it.
 */
export const CoreTraceFilterTerms: readonly TraceFilterVocabularyTerm[] = [
  coreTerm('trace_id', 'string', 'The trace’s OpenTelemetry identifier.', 'trace'),
  coreTerm('input', 'string', 'The root span’s input text.', 'trace'),
  coreTerm('output', 'string', 'The root span’s output text.', 'trace'),
  coreTerm('start_time', 'datetime', 'Start, compared with an ISO 8601 string.', 'trace'),
  coreTerm('end_time', 'datetime', 'End, compared with an ISO 8601 string.', 'trace'),
  coreTerm('latency_ms', 'number', 'Duration in milliseconds.', 'trace'),
  coreTerm('num_spans', 'number', 'Number of spans in the trace.', 'aggregate'),
  coreTerm('error_count', 'number', 'Spans with ERROR status.', 'aggregate'),
  coreTerm('llm_span_count', 'number', 'Number of LLM spans.', 'aggregate'),
  coreTerm('tool_span_count', 'number', 'Number of TOOL spans.', 'aggregate'),
  coreTerm('token_count_total', 'number', 'Prompt and completion tokens.', 'aggregate'),
  coreTerm('token_count_prompt', 'number', 'Prompt tokens.', 'aggregate'),
  coreTerm('token_count_completion', 'number', 'Completion tokens.', 'aggregate'),
  coreTerm('total_cost', 'number', 'Total cost across span cost rows.', 'aggregate'),
  coreTerm('prompt_cost', 'number', 'Prompt cost.', 'aggregate'),
  coreTerm('completion_cost', 'number', 'Completion cost.', 'aggregate'),
  coreTerm('user.id', 'string', 'The root span’s user.id attribute.', 'attribute'),
  coreTerm('metadata["key"]', 'string', 'A root span metadata value.', 'attribute'),
  coreTerm('attributes[...]', 'string', 'A root span attribute by OpenTelemetry key.', 'attribute'),
  coreTerm('spans', 'iterable', 'Every span in the trace.', 'iterable'),
  coreTerm('trace_annotations', 'iterable', 'Annotations on the trace.', 'iterable'),
  coreTerm('span_annotations', 'iterable', 'Annotations on the trace’s spans.', 'iterable'),
  coreTerm('name', 'string', 'A span’s name.', 'element', 'spans'),
  coreTerm('span_kind', 'string', 'LLM, TOOL, AGENT, CHAIN, RETRIEVER, …', 'element', 'spans'),
  coreTerm('status_code', 'string', 'OK, ERROR, or UNSET.', 'element', 'spans'),
  coreTerm('latency_ms', 'number', 'A span’s duration in milliseconds.', 'element', 'spans'),
  coreTerm('llm_token_count_total', 'number', 'Tokens recorded on a span.', 'element', 'spans'),
  coreTerm(
    'cumulative_llm_token_count_total',
    'number',
    'Tokens at or under a span.',
    'element',
    'spans',
  ),
  coreTerm('children', 'iterable', 'A span’s children.', 'element', 'spans'),
  coreTerm('parent_span', 'relation', 'A span’s direct parent.', 'element', 'spans'),
  coreTerm('name', 'string', 'An annotation’s name.', 'element', 'trace_annotations'),
  coreTerm('label', 'string', 'An annotation’s label.', 'element', 'trace_annotations'),
  coreTerm('score', 'number', 'An annotation’s score.', 'element', 'trace_annotations'),
];

function coreTerm(
  name: string,
  type: string,
  description: string,
  category: string,
  iterableName: string | null = null,
): TraceFilterVocabularyTerm {
  return { name, type, description, category, iterableName };
}

/**
 * Completions for the identifier being typed: names that start with it
 * first, then names that contain it, each in vocabulary order. A name typed
 * out in full offers nothing.
 */
export function traceFilterCompletions(
  vocabulary: readonly TraceFilterVocabularyTerm[],
  prefix: string,
  limit = 8,
): TraceFilterCompletion[] {
  const needle = prefix.toLowerCase();

  if (needle.length === 0) return [];

  const seen = new Set<string>();
  const starts: TraceFilterCompletion[] = [];
  const contains: TraceFilterCompletion[] = [];

  for (const candidate of vocabulary) {
    const completion = completionForTerm(candidate);
    const label = completion.label.toLowerCase();

    if (seen.has(completion.label) || label === needle) continue;
    seen.add(completion.label);

    if (label.startsWith(needle)) starts.push(completion);
    else if (label.includes(needle)) contains.push(completion);
  }

  return [...starts, ...contains].slice(0, limit);
}

/** Replaces `range` in `text` with a completion or snippet, selecting its first placeholder. */
export function replaceRange(text: string, range: TextSelection, insert: string): TextEdit {
  const expanded = expandSnippet(insert);
  const before = text.slice(0, range.start);
  const after = text.slice(range.end);

  return {
    text: `${before}${expanded.text}${after}`,
    selection: {
      start: before.length + expanded.selection.start,
      end: before.length + expanded.selection.end,
    },
  };
}

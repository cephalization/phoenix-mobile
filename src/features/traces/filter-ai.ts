/**
 * Natural-language trace filtering, ported from Phoenix's AI query
 * (`js/app/src/components/filter/ai/` and the trace DSL description in
 * `js/app/src/pages/project/traceFilterDSL.ts`). Everything here is pure: the
 * model and the validator are passed in, so the same pipeline runs on device
 * and through Phoenix's chat completions proxy.
 */

import type { ModelSelection } from '@/features/pxi/types';
import {
  CoreTraceFilterTerms,
  loopVariable,
  normalizeTraceFilter,
  type TraceFilterVocabularyTerm,
} from '@/features/traces/filter';

export type TraceFilterAIExample = { description: string; expression: string };

export type TraceFilterAIField = { name: string; description?: string };

/**
 * `full` is Phoenix's prompt, for server models. `compact` fits the on-device
 * model's 4096-token context: field names with their types and the notes that
 * prevent the most common mistakes. Both keep every example, which teach
 * small models the most per token.
 */
export type TraceFilterPromptProfile = 'full' | 'compact';

export type TraceFilterMessage = { role: 'user' | 'assistant'; content: string };

/** A model that answers one request. `messages` always ends with a user turn. */
export type TraceFilterModel = {
  profile: TraceFilterPromptProfile;
  complete: (request: {
    instructions: string;
    messages: TraceFilterMessage[];
    signal?: AbortSignal;
  }) => Promise<string>;
};

export type TraceFilterVerdict = {
  isValid: boolean;
  errorMessage: string | null;
  warnings: string[];
};

export const TraceFilterAIExamples: readonly TraceFilterAIExample[] = [
  { description: 'traces longer than thirty seconds', expression: 'latency_ms > 30_000' },
  { description: 'traces with more than twelve spans', expression: 'num_spans > 12' },
  {
    description: 'traces containing a retriever span',
    expression: "any(span.span_kind == 'RETRIEVER' for span in spans)",
  },
  {
    description: 'traces where every span completed successfully',
    expression:
      "len([span for span in spans]) > 0 and all(span.status_code == 'OK' for span in spans)",
  },
  {
    description: 'traces whose spans used over eight thousand prompt tokens',
    expression: 'sum(span.llm_token_count_prompt for span in spans) > 8_000',
  },
  {
    description: 'traces with a failed child span',
    expression:
      "any(any(child.status_code == 'ERROR' for child in span.children) for span in spans)",
  },
  {
    description: 'traces from the preview deployment',
    expression: "metadata['deployment'] == 'preview'",
  },
  {
    description: 'traces the relevance annotation labeled poor',
    expression: "trace_annotations['relevance'].label == 'poor'",
  },
  {
    description: 'traces with no safety score',
    expression: "trace_annotations['safety'].score is None",
  },
  {
    description: 'traces that called at least three tools',
    expression: "len([span for span in spans if span.span_kind == 'TOOL']) >= 3",
  },
  {
    description: 'traces with a span that cost over five cents',
    expression: 'any(sum(detail.cost for detail in span.cost_details) > 0.05 for span in spans)',
  },
  {
    description: 'traces where a guardrail ran after the model answered',
    expression:
      "max(span.start_time for span in spans if span.span_kind == 'GUARDRAIL') > max(span.start_time for span in spans if span.span_kind == 'LLM')",
  },
  {
    description: 'traces where a planner step used over a thousand tokens',
    expression:
      "any('planner' in span.name and span.cumulative_llm_token_count_total > 1_000 for span in spans)",
  },
  {
    description: 'traces where one span accounts for over half the tokens',
    expression:
      'max(span.cumulative_llm_token_count_total for span in spans) > 0.5 * token_count_total',
  },
  {
    description: 'traces where a chain fanned out to more than five children',
    expression:
      "any(span.span_kind == 'CHAIN' and len([child for child in span.children]) > 5 for span in spans)",
  },
];

export const TraceFilterAINotes: readonly string[] = [
  'Trace and span durations are in milliseconds. Convert seconds and minutes before comparing.',
  'start_time, end_time, span.start_time, and span.end_time compare against ISO 8601 strings; prefer offset-bearing literals.',
  "input and output are the displayed root span's string values and support containment, for example 'refund' in input.",
  "any, all, len, max, min, and sum all take a comprehension over a collection, with or without brackets: any(span.status_code == 'ERROR' for span in spans) and max([span.latency_ms for span in spans]) are both fine. len is the one that requires the brackets — len([span for span in spans if span.span_kind == 'TOOL']) — while len(spans), len(span.children), and len(... for ...) are rejected.",
  "A comprehension has exactly one for clause, and every loop variable in the expression must be distinct. Reach a nested collection by nesting comprehensions: any(any(child.span_kind == 'TOOL' for child in span.children) for span in spans).",
  "Trace-level fields — num_spans, error_count, latency_ms, start_time, end_time, token_count_*, *_cost, input, output — describe the whole trace and cannot appear inside a comprehension over spans. Whenever one span's field must be measured against a trace-level field, lift the comparison out of the comprehension: write max(span.cumulative_llm_token_count_total for span in spans) > 0.8 * token_count_total, never any(span.cumulative_llm_token_count_total > 0.8 * token_count_total for span in spans).",
  'Guard all with a non-empty check when empty collections should not match. Filtered max and min produce None for an empty set, so ordinary comparisons do not match; len and sum produce zero.',
  "A span exposes span.children, span.siblings, span.annotations, and span.cost_details. spans is every span in the trace, and children and siblings are strictly narrower views of it — scan spans unless the request itself limits the scope to one span's children or siblings. An inner comprehension may refer back to its enclosing span, such as sibling.name == span.name.",
  "The direct-parent relation is span.parent_span, not span.parent. Use span.parent_span.<field> for parent fields and guard with span.parent_span is not None when needed; parent_span exposes the parent's own fields only, so span.parent_span.children and span.parent_span.annotations are rejected. span.parent_span is None includes dangling-parent orphans; span.parent_id is None identifies only spans with no parent edge.",
  "span.span_kind is the span's category: LLM, TOOL, AGENT, CHAIN, RETRIEVER, EMBEDDING, RERANKER, GUARDRAIL, EVALUATOR, or DECISION. A request naming one of those categories — an agent span, a tool call, a retriever — means span.span_kind. A request naming a component, step, or role that is not a category — a subagent, the finalize step, a planner — means span.name, matched by containment, because span names carry prefixes and suffixes: 'subagent' in span.name.",
  "A span described as under, inside, beneath, or launched by another is reached through span.parent_span: the qualifier describes the parent, so it becomes 'subagent' in span.parent_span.name, while span.span_kind and span.annotations still describe the span itself.",
  "A relation clause says nothing about the kind of the span at its other end. When the request describes one span's children, siblings, or parent, constrain only the end it actually names and leave the other end's span_kind unconstrained.",
  "A span's identity is its name, so a retry, repeat, or duplicate of a span is another span carrying the same name. Correlate it from the nested comprehension — other.name == span.name and other.start_time > span.start_time — rather than matching only its kind.",
  'span.llm_token_count_*, span.latency_ms, and span.status_code describe that span alone; span.cumulative_* aggregate the span together with every span beneath it. Work done anywhere under a named span — or its absence — is a cumulative_ field on that span, not its own count and not the trace-wide total. A span that is not itself an LLM span records llm_token_count_total == 0 whatever its subtree did, so that field can never answer whether a component did LLM work; cumulative_llm_token_count_total can.',
  "Inside a trace filter, a span has no single cost field. span.cost_details holds one row per token type, so a span's own cost is sum(detail.cost for detail in span.cost_details) — one row is a component of that cost, never the whole of it. total_cost, prompt_cost, and completion_cost are trace-wide.",
  'Nothing sorts, ranks, or orders. Express one event following another by comparing timestamps across two filtered reductions: max(span.start_time for span in spans if <later>) > max(span.start_time for span in spans if <earlier>). Compare start_time to start_time unless the request is about completion.',
  "Annotation grain is explicit: keyed trace annotations use trace_annotations['name'].score or .label. Span annotations are iterated through span_annotations or span.annotations; annotations[...] is not valid. An annotation's identity is annotation.name, annotation.label is its categorical verdict, and annotation.score is its number — never match a name against label.",
  "Project-specific trace annotation names and displayed-root attribute keys are discovered at runtime. Preserve names from the request verbatim in trace_annotations['name'], metadata['key'], user.id, or attributes['otel.key']; do not invent near-synonyms.",
  'Span names, kinds, statuses, and annotation names taken from the request are identifiers, not described free text: match them as given, without capitalization variants, synonyms, or added spellings.',
  "attributes string subscripts are OpenTelemetry wire keys. attributes['llm.model_name'] and attributes['llm']['model_name'] name the same key.",
  'error_count, tool_span_count, and llm_span_count are trace-wide span counts with no span-level equivalents. token_count_* sums LLM spans, while *_cost sums configured span costs.',
  'The only helpers are any, all, len, max, min, sum, str, and float. There are no method calls — no .lower(), no .startswith() — and no sorted(), list indexing, or slicing; approximate a percentile with max() or a threshold count instead.',
];

/** Condensed notes for the on-device prompt: the rules small models break most. */
const CompactNotes: readonly string[] = [
  'Durations are milliseconds: 30 seconds is 30_000.',
  "input and output are the root span's text: 'refund' in input.",
  "Span conditions go in a comprehension over spans: any(span.status_code == 'ERROR' for span in spans). any, all, max, min, and sum take a comprehension; len needs brackets: len([span for span in spans if span.span_kind == 'TOOL']).",
  'Trace-level fields (num_spans, error_count, latency_ms, token_count_*, *_cost, input, output) never appear inside a comprehension.',
  "span.span_kind is one of LLM, TOOL, AGENT, CHAIN, RETRIEVER, EMBEDDING, RERANKER, GUARDRAIL, EVALUATOR. Any other component or step name is matched with 'name' in span.name.",
  "A span's parent is span.parent_span (not span.parent); its children are span.children.",
  "Annotations: trace_annotations['name'].score or .label.",
  'The only helpers are any, all, len, max, min, sum, str, and float. No method calls, sorting, or indexing.',
];

/**
 * The model-facing field list. Element fields are written with their loop
 * variable (`span.latency_ms`) and the `attributes[...]` placeholder in its
 * writable form, matching Phoenix's `getTraceFilterAIFieldName`.
 */
export function traceFilterAIFields(
  vocabulary: readonly TraceFilterVocabularyTerm[],
): TraceFilterAIField[] {
  const terms = vocabulary.length > 0 ? vocabulary : CoreTraceFilterTerms;

  return terms.map((term) => ({
    name: aiFieldName(term),
    description: term.description || undefined,
  }));
}

function aiFieldName(term: TraceFilterVocabularyTerm) {
  if (term.name === 'attributes[...]') return "attributes['key']";

  if (!term.iterableName) return term.name;

  return `${loopVariable(term.iterableName)}.${term.name}`;
}

/** Most observed names the compact prompt lists, so a busy project cannot crowd out the rules. */
const CompactObservedLimit = 16;

/**
 * Compact fields: the core names grouped by type, without descriptions, plus
 * the project's observed attribute keys and annotation names.
 */
function compactFieldLines(vocabulary: readonly TraceFilterVocabularyTerm[]) {
  const core = new Set(CoreTraceFilterTerms.map(aiFieldName));
  const byType = new Map<string, string[]>();

  for (const candidate of CoreTraceFilterTerms) {
    const names = byType.get(candidate.type) ?? [];
    names.push(aiFieldName(candidate));
    byType.set(candidate.type, names);
  }

  const observed = vocabulary
    .flatMap((candidate) => {
      const observedTerm =
        candidate.category === 'attribute' || candidate.category === 'annotation';

      const name = aiFieldName(candidate);

      return observedTerm && !core.has(name) ? [name] : [];
    })
    .slice(0, CompactObservedLimit);

  const lines = [...byType].map(([type, names]) => `- ${type}: ${names.join(', ')}`);

  if (observed.length > 0) lines.push(`- seen in this project: ${observed.join(', ')}`);

  return lines.join('\n');
}

function fullFieldLines(vocabulary: readonly TraceFilterVocabularyTerm[]) {
  return traceFilterAIFields(vocabulary)
    .map((field) =>
      field.description ? `- ${field.name}: ${field.description}` : `- ${field.name}`,
    )
    .join('\n');
}

/**
 * The system prompt, in Phoenix's shape: XML-tagged syntax, fields, notes,
 * examples, rules, and an output contract of brief `<thinking>` followed by
 * the `<expression>`. The compact profile states the same contract in fewer words.
 */
export function buildTraceFilterInstructions(
  vocabulary: readonly TraceFilterVocabularyTerm[],
  profile: TraceFilterPromptProfile,
) {
  const compact = profile === 'compact';

  const exampleLines = TraceFilterAIExamples.map(
    (example) => `- "${example.description}" -> ${example.expression}`,
  ).join('\n');

  const noteLines = (compact ? CompactNotes : TraceFilterAINotes)
    .map((note) => `- ${note}`)
    .join('\n');

  const fieldLines = compact ? compactFieldLines(vocabulary) : fullFieldLines(vocabulary);

  return `You are an expert translator from plain language to a filter DSL. You translate a natural-language request into one filter expression for traces.

A filter is a Python-like boolean expression evaluated against each of the traces; those it is true for are kept.

<syntax>
- Comparisons are ==, !=, >, >=, <, <=, and string literals use single quotes.
- Clauses combine with \`and\`, \`or\`, and \`not\`. Parenthesize when mixing \`and\` with \`or\`.
- Substring search is written \`'text' in field\`, and it is case-sensitive.
- A missing value is tested with \`is None\`, a present one with \`is not None\`.${compact ? '' : " An empty text value is `== ''` — never a guessed serialization like `'[]'`."}
</syntax>

<fields>
An expression may reference only these fields:
${fieldLines}
</fields>

<notes>
${noteLines}
</notes>

<examples>
${exampleLines}
</examples>

<rules>
${(compact ? CompactRules : FullRules).map((rule) => `- ${rule}`).join('\n')}
</rules>

<output_format>
${
  compact
    ? 'Answer in exactly this format, with the expression on one line and nothing after it:'
    : `Reason before you answer, briefly:
1. In <thinking> tags: one or two short sentences — which field(s) the request points at, and whether it names literal values or describes text whose surface forms you must search for.
2. In <expression> tags: the expression alone — one line, no explanation, no code fences, no surrounding quotes.
`
}
<thinking>your brief reasoning</thinking>
<expression>the filter expression</expression>
</output_format>`;
}

const FullRules: readonly string[] = [
  'Use the values the request gives you verbatim. A key, name, or label the user typed is what the data holds; do not correct its spelling or casing.',
  "Verbatim applies to identifiers, not phrasing. A substring search over free text like an error or status message matches on the term's root form: a request about calls that timed out searches for 'timeout'.",
  "When the request describes a quality, sentiment, or behavior of free text rather than naming a value — a greeting, an angry customer, a promise to follow up — the request's own words will not appear in the data. Search the one field where that text lives for the surface forms it actually contains, combining several with `or`: root forms that cover inflections, common phrasings, and a capitalization variant when a word can open a sentence. For example, messages that open with a greeting (in a free-text field f): 'hello' in f or 'Hello' in f or 'Hi ' in f. Echoing the request's abstract word (searching for 'greeting' itself) finds nothing, because that word is a description of the text, not part of it. This expansion is only for described text: when the request names the term to search for — a phrase from an error message, a status, a quoted string — search for exactly that term in its root form and nothing else, with no added capitalization or spelling variants and no synonyms.",
  'Translate every part of the request. A request that states three facts is three clauses joined with `and`.',
  'Write the narrowest expression that answers the request. Never add an `or` over a field the request did not name, an equality a substring test already covers, or an `is not None` guard on a field another clause already compares or searches. (The `or` of surface forms for one described phenomenon on its one field is not hedging — it is the translation. Searching extra fields "just in case" is: expansion multiplies terms, never fields.)',
  'The notes are exact: when a note states how attribute paths chain, what a collection holds, or what syntax this dialect lacks, it overrides any instinct from other query languages.',
  'When the request implies a threshold without giving one, choose a sensible default — "slow" is latency over 10 seconds.',
  'A filter cannot sort, rank, or limit. "the slowest", with or without a count, is the default slow threshold; drop the count.',
  'When the request cannot be expressed with the fields above, answer with the closest expressible approximation rather than inventing a field.',
];

const CompactRules: readonly string[] = [
  'Use names and values from the request verbatim; do not correct spelling or casing.',
  'Translate every part of the request; three facts are three clauses joined with `and`.',
  'Write the narrowest expression that answers the request.',
  'When the request describes text rather than quoting it, search the one field it lives in for words it would contain, joined with `or`.',
  'Without a threshold, choose a sensible one: "slow" is latency over 10 seconds. Filters cannot sort or limit.',
  'Never invent a field; use the closest expressible approximation.',
];

/** The follow-up turn after a rejected expression: one chance to fix it with the validator's error. */
export function buildTraceFilterRepairPrompt(errorMessage: string) {
  return `That expression failed validation with the error: ${errorMessage || 'invalid filter condition'}. Respond in the same format — brief <thinking> tags, then the corrected filter expression alone in <expression> tags.`;
}

/**
 * Normalizes raw model output into a one-line expression. Prefers the
 * `<expression>` answer and never surfaces the reasoning before it; models
 * that ignore the format still get through with code fences, labels like
 * "Expression:", and wrapping backticks stripped.
 */
export function extractFilterExpression(text: string) {
  let expression = text.trim();
  const openTag = /<expression>/i.exec(expression);

  if (openTag !== null) {
    expression = expression.slice(openTag.index + openTag[0].length);
    const closeIndex = expression.search(/<\/expression/i);

    if (closeIndex !== -1) expression = expression.slice(0, closeIndex);
    expression = expression.trim();
  } else {
    expression = expression.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();

    if (/<thinking>/i.test(expression) || expression.startsWith('<')) return '';
  }

  expression = expression.replace(/<\/[a-z]*$/i, '').trim();
  const fence = /^```[^\n`]*\n?([\s\S]*?)(?:```)?$/.exec(expression);

  if (fence) expression = fence[1].trim();
  expression = expression.replace(/^(?:filter(?: expression)?|expression|condition)\s*:\s*/i, '');
  const backticks = /^`([^`]*)`$/.exec(expression);

  if (backticks) expression = backticks[1];

  return normalizeTraceFilter(expression);
}

/**
 * Collapses a conversation into one prompt for a single-turn model such as
 * Apple's on-device model, which takes instructions and one prompt.
 */
export function flattenTraceFilterMessages(messages: readonly TraceFilterMessage[]) {
  if (messages.length === 1) return messages[0].content;

  return messages
    .map((message) =>
      message.role === 'user'
        ? `Request: ${message.content}`
        : `Your previous answer: <expression>${message.content}</expression>`,
    )
    .join('\n\n');
}

/**
 * The model string Phoenix's `/v1/chat/completions` proxy parses
 * (`encodeServerModelId`): `{provider}:{model}` with the provider lowercased,
 * or `custom:{providerGlobalId}:{model}`. The server splits on the first
 * colons, so model names containing colons survive.
 */
export function chatCompletionsModelId(selection: ModelSelection) {
  return selection.providerType === 'custom'
    ? `custom:${selection.providerId}:${selection.modelName}`
    : `${selection.provider.toLowerCase()}:${selection.modelName}`;
}

/** Rough token count for prompt budgeting: code-heavy text runs about 3.5 characters a token. */
export function estimateTokens(text: string) {
  return Math.ceil(text.length / 3.5);
}

export type TraceFilterGenerationPhase = 'generating' | 'validating' | 'repairing';

export class TraceFilterGenerationError extends Error {
  override name = 'TraceFilterGenerationError';
}

/**
 * Translates a request into a trace filter: one completion, a validation, and
 * when the validator rejects it one repair round with the error. Returns the
 * final expression with its verdict, which is null when the validator could
 * not answer (the filter field validates again before applying).
 */
export async function generateTraceFilter({
  model,
  onPhase,
  query,
  signal,
  validate,
  vocabulary,
}: {
  model: TraceFilterModel;
  query: string;
  vocabulary: readonly TraceFilterVocabularyTerm[];
  validate: (expression: string) => Promise<TraceFilterVerdict | null>;
  onPhase?: (phase: TraceFilterGenerationPhase) => void;
  signal?: AbortSignal;
}): Promise<{ expression: string; verdict: TraceFilterVerdict | null }> {
  const instructions = buildTraceFilterInstructions(vocabulary, model.profile);
  const messages: TraceFilterMessage[] = [{ role: 'user', content: query.trim() }];

  onPhase?.('generating');

  const expression = extractFilterExpression(
    await model.complete({ instructions, messages, signal }),
  );

  if (!expression) throw new TraceFilterGenerationError('The model did not return a filter.');

  const verdict = await validateQuietly(validate, expression, onPhase, signal);

  if (verdict === null || verdict.isValid) return { expression, verdict };

  onPhase?.('repairing');

  const repaired = extractFilterExpression(
    await model.complete({
      instructions,
      messages: [
        ...messages,
        { role: 'assistant', content: expression },
        { role: 'user', content: buildTraceFilterRepairPrompt(verdict.errorMessage ?? '') },
      ],
      signal,
    }),
  );

  if (!repaired) return { expression, verdict };

  return {
    expression: repaired,
    verdict: await validateQuietly(validate, repaired, onPhase, signal),
  };
}

async function validateQuietly(
  validate: (expression: string) => Promise<TraceFilterVerdict | null>,
  expression: string,
  onPhase: ((phase: TraceFilterGenerationPhase) => void) | undefined,
  signal: AbortSignal | undefined,
) {
  onPhase?.('validating');

  try {
    return await validate(expression);
  } catch (error) {
    if (signal?.aborted) throw error;

    // A transport failure is not a generation failure: hand the expression
    // back unjudged and let the field's own validation ask again.
    return null;
  }
}

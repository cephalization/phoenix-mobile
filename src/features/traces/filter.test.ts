import { describe, expect, it } from 'vite-plus/test';

import {
  combineTraceFilters,
  completionForTerm,
  CoreTraceFilterTerms,
  expandSnippet,
  normalizeTraceFilter,
  rememberTraceFilter,
  replaceRange,
  snippetText,
  straightenQuotes,
  tokenAtCursor,
  traceFilterCompletions,
  TraceFilterSnippets,
} from './filter';

describe('combineTraceFilters', () => {
  it('passes a single condition through and drops blanks', () => {
    expect(combineTraceFilters([null, '  latency_ms > 1000 ', undefined, ''])).toBe(
      'latency_ms > 1000',
    );
  });

  it('parenthesizes each condition so an or cannot capture its neighbour', () => {
    expect(combineTraceFilters(['error_count > 0', "'a' in input or 'b' in input"])).toBe(
      "(error_count > 0) and ('a' in input or 'b' in input)",
    );
  });

  it('returns undefined when nothing filters', () => {
    expect(combineTraceFilters([null, ' '])).toBeUndefined();
  });
});

describe('quotes and normalization', () => {
  it('straightens smart quotes without changing length', () => {
    const typed = 'metadata[“env”] == ‘prod’';

    expect(straightenQuotes(typed)).toBe('metadata["env"] == \'prod\'');
    expect(straightenQuotes(typed)).toHaveLength(typed.length);
  });

  it('joins lines and trims', () => {
    expect(normalizeTraceFilter('  num_spans > 3\n  and error_count > 0 ')).toBe(
      'num_spans > 3 and error_count > 0',
    );
  });
});

describe('rememberTraceFilter', () => {
  it('moves a repeat to the front and caps the list', () => {
    const recent = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

    expect(rememberTraceFilter(recent, 'c')).toEqual(['c', 'a', 'b', 'd', 'e', 'f', 'g', 'h']);
    expect(rememberTraceFilter(recent, 'new')).toEqual(['new', 'a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });

  it('ignores an empty expression', () => {
    expect(rememberTraceFilter(['a'], '  ')).toEqual(['a']);
  });
});

describe('snippets', () => {
  it('ports every Phoenix trace snippet with a label', () => {
    expect(TraceFilterSnippets).toHaveLength(22);
    expect(TraceFilterSnippets.every((snippet) => snippet.label.length > 0)).toBe(true);
  });

  it('expands placeholders to their defaults and selects the first', () => {
    expect(expandSnippet("'${search text}' in input or '${search text}' in output")).toEqual({
      text: "'search text' in input or 'search text' in output",
      selection: { start: 1, end: 12 },
    });
  });

  it('selects a placeholder after earlier expanded text', () => {
    const edit = expandSnippet('metadata["${key}"] == \'${value}\'');

    expect(edit.text).toBe('metadata["key"] == \'value\'');
    expect(edit.text.slice(edit.selection.start, edit.selection.end)).toBe('key');
  });

  it('puts the caret at the end without placeholders', () => {
    expect(expandSnippet('error_count > 0')).toEqual({
      text: 'error_count > 0',
      selection: { start: 15, end: 15 },
    });
  });

  it('renders snippets as plain text', () => {
    expect(snippetText('num_spans >= ${5}')).toBe('num_spans >= 5');
  });
});

describe('tokenAtCursor', () => {
  it('finds the identifier being typed, including dotted names', () => {
    const text = 'any(span.lat for span in spans)';

    expect(tokenAtCursor(text, 12)).toEqual({ prefix: 'span.lat', range: { start: 4, end: 12 } });
  });

  it('covers the rest of the word after the caret', () => {
    expect(tokenAtCursor('latency_ms > 1', 3)).toEqual({
      prefix: 'lat',
      range: { start: 0, end: 10 },
    });
  });

  it('ignores string literals, numbers, and whitespace', () => {
    expect(tokenAtCursor("'lat' in input", 3)).toBeNull();
    expect(tokenAtCursor('latency_ms > 1_0', 16)).toBeNull();
    expect(tokenAtCursor('latency_ms > ', 13)).toBeNull();
  });
});

describe('completions', () => {
  it('ranks prefix matches before substring matches', () => {
    const labels = traceFilterCompletions(CoreTraceFilterTerms, 'token').map(
      (completion) => completion.label,
    );

    expect(labels.slice(0, 3)).toEqual([
      'token_count_total',
      'token_count_prompt',
      'token_count_completion',
    ]);
  });

  it('writes element fields with their loop variable', () => {
    const labels = traceFilterCompletions(CoreTraceFilterTerms, 'span.st').map(
      (completion) => completion.label,
    );

    expect(labels).toContain('span.status_code');
  });

  it('offers nothing for a name typed out in full', () => {
    expect(traceFilterCompletions(CoreTraceFilterTerms, 'num_spans')).toEqual([]);
  });

  it('scaffolds a comprehension for a collection', () => {
    const spans = CoreTraceFilterTerms.find((candidate) => candidate.name === 'spans');

    expect(spans && completionForTerm(spans).insert).toBe(
      'any(${span.latency_ms > 1_000} for span in spans)',
    );
  });

  it('replaces the token and selects the first placeholder', () => {
    const edit = replaceRange(
      'num_spans > 2 and spa',
      { start: 18, end: 21 },
      'any(${x} for span in spans)',
    );

    expect(edit.text).toBe('num_spans > 2 and any(x for span in spans)');
    expect(edit.text.slice(edit.selection.start, edit.selection.end)).toBe('x');
  });
});

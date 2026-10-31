import { describe, expect, it } from 'vitest';

import type { TraceFilterVocabularyTerm } from './filter';
import {
  buildTraceFilterInstructions,
  buildTraceFilterRepairPrompt,
  chatCompletionsModelId,
  estimateTokens,
  extractFilterExpression,
  flattenTraceFilterMessages,
  generateTraceFilter,
  type TraceFilterMessage,
  type TraceFilterModel,
  type TraceFilterVerdict,
} from './filter-ai';

const observed: TraceFilterVocabularyTerm[] = [
  {
    name: 'latency_ms',
    type: 'number',
    description: 'The trace’s duration in milliseconds.',
    category: 'trace',
    iterableName: null,
  },
  {
    name: 'status_code',
    type: 'string',
    description: 'A span’s status.',
    category: 'element',
    iterableName: 'spans',
  },
  {
    name: 'attributes[...]',
    type: 'string',
    description: 'A root attribute.',
    category: 'attribute',
    iterableName: null,
  },
  {
    name: 'attributes["session.id"]',
    type: 'string',
    description: 'Observed attribute.',
    category: 'attribute',
    iterableName: null,
  },
];

describe('buildTraceFilterInstructions', () => {
  it('teaches the full vocabulary with descriptions and writable names', () => {
    const prompt = buildTraceFilterInstructions(observed, 'full');

    expect(prompt).toContain('- latency_ms: The trace’s duration in milliseconds.');
    expect(prompt).toContain('- span.status_code: A span’s status.');
    expect(prompt).toContain("- attributes['key']: A root attribute.");
    expect(prompt).toContain('<expression>the filter expression</expression>');
    expect(prompt).toContain('"traces longer than thirty seconds" -> latency_ms > 30_000');
  });

  it('keeps the compact prompt inside the on-device context budget', () => {
    // A busy project: many observed attribute keys and annotation names.
    const busy: TraceFilterVocabularyTerm[] = Array.from({ length: 200 }, (_, index) => ({
      name: `attributes["custom.key.number.${index}"]`,
      type: 'string',
      description: 'Observed displayed-root attribute with a long description.'.repeat(4),
      category: 'attribute',
      iterableName: null,
    }));

    const prompt = buildTraceFilterInstructions(busy, 'compact');

    // 4096 tokens total: leave room for the request, a repair turn, and the answer.
    expect(estimateTokens(prompt)).toBeLessThan(2_400);
    expect(prompt).toContain('seen in this project: attributes["custom.key.number.0"]');
    expect(prompt).not.toContain('custom.key.number.16"]');
    expect(prompt).not.toContain('long description');
  });

  it('falls back to the core trace fields without a vocabulary', () => {
    expect(buildTraceFilterInstructions([], 'full')).toContain('- error_count:');
  });
});

describe('extractFilterExpression', () => {
  it('takes the tagged answer and drops the reasoning', () => {
    expect(
      extractFilterExpression(
        '<thinking>latency field</thinking>\n<expression>latency_ms > 10_000</expression>',
      ),
    ).toBe('latency_ms > 10_000');
  });

  it('tolerates code fences, labels, and backticks', () => {
    expect(extractFilterExpression('```python\nerror_count > 0\n```')).toBe('error_count > 0');
    expect(extractFilterExpression('Expression: num_spans > 3')).toBe('num_spans > 3');
    expect(extractFilterExpression('`num_spans > 3`')).toBe('num_spans > 3');
  });

  it('returns nothing while reasoning is unfinished', () => {
    expect(extractFilterExpression('<thinking>still going')).toBe('');
  });

  it('joins a wrapped answer onto one line with straight quotes', () => {
    expect(extractFilterExpression('<expression>‘refund’ in input\n and error_count > 0')).toBe(
      "'refund' in input and error_count > 0",
    );
  });
});

describe('chatCompletionsModelId', () => {
  it('lowercases built-in providers and keeps colons in model names', () => {
    expect(
      chatCompletionsModelId({
        providerType: 'builtin',
        provider: 'OLLAMA',
        modelName: 'llama3:8b',
      }),
    ).toBe('ollama:llama3:8b');
  });

  it('prefixes custom providers', () => {
    expect(
      chatCompletionsModelId({ providerType: 'custom', providerId: 'R2VuOjE=', modelName: 'm' }),
    ).toBe('custom:R2VuOjE=:m');
  });
});

describe('flattenTraceFilterMessages', () => {
  it('passes one request through and spells out a repair conversation', () => {
    expect(flattenTraceFilterMessages([{ role: 'user', content: 'slow' }])).toBe('slow');

    expect(
      flattenTraceFilterMessages([
        { role: 'user', content: 'slow' },
        { role: 'assistant', content: 'latency > 1' },
        { role: 'user', content: buildTraceFilterRepairPrompt('invalid name `latency`') },
      ]),
    ).toContain('Your previous answer: <expression>latency > 1</expression>');
  });
});

function scriptedModel(answers: string[]) {
  const requests: TraceFilterMessage[][] = [];

  const model: TraceFilterModel = {
    profile: 'full',
    complete: async ({ messages }) => {
      requests.push(messages);

      return answers.shift() ?? '';
    },
  };

  return { model, requests };
}

const valid: TraceFilterVerdict = { isValid: true, errorMessage: null, warnings: [] };

describe('generateTraceFilter', () => {
  it('returns a valid first answer without a repair round', async () => {
    const { model, requests } = scriptedModel(['<expression>latency_ms > 10_000</expression>']);
    const phases: string[] = [];

    const result = await generateTraceFilter({
      model,
      query: 'slow traces',
      vocabulary: [],
      validate: async () => valid,
      onPhase: (phase) => phases.push(phase),
    });

    expect(result).toEqual({ expression: 'latency_ms > 10_000', verdict: valid });
    expect(requests).toHaveLength(1);
    expect(phases).toEqual(['generating', 'validating']);
  });

  it('repairs once with the validator’s error and reports the final verdict', async () => {
    const { model, requests } = scriptedModel([
      '<expression>latency > 10_000</expression>',
      '<expression>latency_ms > 10_000</expression>',
    ]);

    const validate = async (expression: string): Promise<TraceFilterVerdict> =>
      expression.startsWith('latency_ms')
        ? valid
        : { isValid: false, errorMessage: 'invalid name `latency`', warnings: [] };

    const result = await generateTraceFilter({ model, query: 'slow', vocabulary: [], validate });

    expect(result).toEqual({ expression: 'latency_ms > 10_000', verdict: valid });
    expect(requests[1]).toEqual([
      { role: 'user', content: 'slow' },
      { role: 'assistant', content: 'latency > 10_000' },
      { role: 'user', content: buildTraceFilterRepairPrompt('invalid name `latency`') },
    ]);
  });

  it('stops after one repair and returns the rejection', async () => {
    const rejected = { isValid: false, errorMessage: 'nope', warnings: [] };

    const { model, requests } = scriptedModel([
      '<expression>a</expression>',
      '<expression>b</expression>',
    ]);

    const result = await generateTraceFilter({
      model,
      query: 'x',
      vocabulary: [],
      validate: async () => rejected,
    });

    expect(result).toEqual({ expression: 'b', verdict: rejected });
    expect(requests).toHaveLength(2);
  });

  it('hands back an unjudged expression when the validator fails', async () => {
    const { model } = scriptedModel(['<expression>num_spans > 3</expression>']);

    const result = await generateTraceFilter({
      model,
      query: 'x',
      vocabulary: [],
      validate: async () => {
        throw new Error('offline');
      },
    });

    expect(result).toEqual({ expression: 'num_spans > 3', verdict: null });
  });

  it('fails when the model answers with no expression', async () => {
    const { model } = scriptedModel(['<thinking>hmm']);

    await expect(
      generateTraceFilter({ model, query: 'x', vocabulary: [], validate: async () => valid }),
    ).rejects.toThrow('did not return a filter');
  });
});

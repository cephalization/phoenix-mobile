import { describe, expect, it } from 'vitest';

import {
  addRecentModel,
  availableModel,
  buildCatalog,
  buildProviderOptions,
  type CatalogInput,
  credentialState,
  customModelOption,
  customModelProviderNote,
  defaultSelection,
  inferProviderFromModelName,
  MatchScore,
  modelKey,
  modelDisplayName,
  rankModels,
  recommendedRows,
  resolveModelRow,
  tokenMatchScore,
} from './model-search';
import type { ModelSelection } from './types';

const input: CatalogInput = {
  modelProviders: [
    { key: 'OPENAI', name: 'OpenAI', dependenciesInstalled: true, credentialsSet: true },
    {
      key: 'AZURE_OPENAI',
      name: 'Azure OpenAI',
      dependenciesInstalled: true,
      credentialsSet: false,
    },
    { key: 'ANTHROPIC', name: 'Anthropic', dependenciesInstalled: true, credentialsSet: true },
    { key: 'AWS', name: 'AWS Bedrock', dependenciesInstalled: true, credentialsSet: false },
    { key: 'XAI', name: 'xAI', dependenciesInstalled: true, credentialsSet: false },
    { key: 'OLLAMA', name: 'Ollama', dependenciesInstalled: true, credentialsSet: false },
    { key: 'GOOGLE', name: 'Google Gemini', dependenciesInstalled: false, credentialsSet: true },
    { key: 'MINIMAX', name: 'MiniMax', dependenciesInstalled: true, credentialsSet: false },
  ],
  playgroundModels: [
    { providerKey: 'OPENAI', name: 'gpt-5-mini' },
    { providerKey: 'OPENAI', name: 'gpt-6-sol' },
    { providerKey: 'OPENAI', name: 'gpt-4o-mini' },
    { providerKey: 'OPENAI', name: 'o3' },
    { providerKey: 'AZURE_OPENAI', name: 'gpt-4o' },
    { providerKey: 'ANTHROPIC', name: 'claude-opus-5' },
    { providerKey: 'ANTHROPIC', name: 'claude-opus-5-5' },
    { providerKey: 'ANTHROPIC', name: 'claude-sonnet-5-5' },
    { providerKey: 'AWS', name: 'anthropic.claude-opus-5-5' },
    { providerKey: 'XAI', name: 'grok-4' },
    { providerKey: 'GOOGLE', name: 'gemini-3.1-pro' },
    { providerKey: 'MINIMAX', name: 'minimax-m2' },
    { providerKey: 'OLLAMA', name: 'llama3.2' },
  ],
  customProviders: [{ id: 'Q3VzdG9tOjE=', name: 'Gateway', sdk: 'OPENAI', modelNames: ['acme-1'] }],
};

const providers = buildProviderOptions(input);
const rows = buildCatalog({ ...input, providers });

const ids = (result: { modelName: string; providerName: string }[]) =>
  result.map((row) => `${row.providerName}/${row.modelName}`);

describe('catalog', () => {
  it('keeps no-key providers, marks credential states, and drops uninstalled providers', () => {
    expect(providers.map((option) => [option.name, option.credentialState])).toEqual([
      ['OpenAI', 'ready'],
      ['Azure OpenAI', 'may-work'],
      ['Anthropic', 'ready'],
      ['AWS Bedrock', 'may-work'],
      ['xAI', 'no-key'],
      ['Ollama', 'ready'],
      ['MiniMax', 'no-key'],
      ['Gateway', 'ready'],
    ]);
    expect(rows.some((row) => row.provider === 'GOOGLE')).toBe(false);
    expect(rows.find((row) => row.modelName === 'acme-1')?.selection).toEqual({
      providerType: 'custom',
      providerId: 'Q3VzdG9tOjE=',
      modelName: 'acme-1',
    });
  });

  it('labels curated models and lists them in curated order', () => {
    expect(recommendedRows(rows).map((row) => row.displayName)).toEqual([
      'Claude Opus 5.5',
      'Claude Sonnet 5.5',
      'GPT-6 Sol',
    ]);
    expect(credentialState({ key: 'OLLAMA', credentialsSet: false })).toBe('ready');
  });

  it('defaults to Claude Opus 5.5 when Anthropic is ready, else a ready model', () => {
    expect(defaultSelection(rows, recommendedRows(rows))).toEqual({
      providerType: 'builtin',
      provider: 'ANTHROPIC',
      modelName: 'claude-opus-5-5',
    });

    const noKeys = buildProviderOptions({
      ...input,
      modelProviders: input.modelProviders.map((provider) => ({
        ...provider,
        credentialsSet: false,
      })),
      customProviders: [],
    });

    const noKeyRows = buildCatalog({ ...input, customProviders: [], providers: noKeys });

    expect(defaultSelection(noKeyRows, recommendedRows(noKeyRows))).toEqual({
      providerType: 'builtin',
      provider: 'OLLAMA',
      modelName: 'llama3.2',
    });
  });

  it('resolves models outside the catalog, including deleted custom providers', () => {
    const typed = resolveModelRow({
      model: { providerType: 'builtin', provider: 'OPENAI', modelName: 'gpt-7-preview' },
      providers,
      rows,
    });

    expect(typed).toMatchObject({ providerName: 'OpenAI', credentialState: 'ready' });
    expect(typed.isProviderMissing).toBe(false);

    const gone: ModelSelection = { providerType: 'custom', providerId: 'gone', modelName: 'x' };

    expect(resolveModelRow({ model: gone, providers, rows })).toMatchObject({
      providerName: 'Deleted provider',
      credentialState: 'no-key',
      isProviderMissing: true,
    });
    expect(availableModel({ providers, rows }, gone)).toBeUndefined();
    expect(
      availableModel(
        { providers, rows },
        { providerType: 'custom', providerId: 'Q3VzdG9tOjE=', modelName: 'typed' },
      ),
    ).toBeDefined();
    expect(
      modelDisplayName({ providerType: 'builtin', provider: 'OPENAI', modelName: 'gpt-6-sol' }),
    ).toBe('GPT-6 Sol');
    expect(modelDisplayName(gone)).toBe('x');
  });
});

describe('tokenMatchScore', () => {
  it('ranks exact, prefix, substring, word-start, and separator-stripped matches', () => {
    expect(tokenMatchScore('claude-opus-5', 'CLAUDE-OPUS-5')).toBe(MatchScore.exact);
    expect(tokenMatchScore('claude-opus-5', 'claude-op')).toBe(MatchScore.prefix);
    expect(tokenMatchScore('claude-opus-5', 'opus')).toBe(MatchScore.substring);
    expect(tokenMatchScore('claude-opus-5', 'opus 5')).toBe(MatchScore.tokens);
    expect(tokenMatchScore('gpt-4o-mini', '4o mini')).toBe(MatchScore.tokens);
    expect(tokenMatchScore('claude-opus-5', 'opus5')).toBe(MatchScore.collapsed);
    expect(tokenMatchScore('claude-opus-5', 'sonnet')).toBeNull();
    expect(tokenMatchScore('claude-opus-5', '  ')).toBeNull();
  });

  it('ignores Bedrock and gateway prefixes on either side', () => {
    expect(tokenMatchScore('us.anthropic.claude-opus-5-5', 'claude-opus-5-5')).toBe(
      MatchScore.exact,
    );
    expect(tokenMatchScore('claude-opus-5-5', 'global.anthropic.claude-opus-5-5')).toBe(
      MatchScore.exact,
    );
    expect(tokenMatchScore('anthropic.claude-opus-5-5', 'claude-op')).toBe(MatchScore.prefix);
  });
});

describe('rankModels', () => {
  it('returns nothing for an empty query', () => {
    expect(rankModels({ rows, query: '   ' })).toEqual([]);
  });

  it('puts better matches first, then curated, then ready providers, then shorter ids', () => {
    expect(ids(rankModels({ rows, query: 'claude-opus' }))).toEqual([
      'Anthropic/claude-opus-5-5',
      'Anthropic/claude-opus-5',
      'AWS Bedrock/anthropic.claude-opus-5-5',
    ]);
  });

  it('matches curated display names', () => {
    expect(ids(rankModels({ rows, query: 'Sonnet 5.5' }))[0]).toBe('Anthropic/claude-sonnet-5-5');
  });

  it('breaks ties by recency', () => {
    const recent = [
      modelKey({ providerType: 'builtin', provider: 'OPENAI', modelName: 'gpt-4o-mini' }),
    ];

    // `mini` starts MiniMax's name, so its model ranks as a prefix match first.
    expect(ids(rankModels({ rows, query: 'mini' }))).toEqual([
      'MiniMax/minimax-m2',
      'OpenAI/gpt-5-mini',
      'OpenAI/gpt-4o-mini',
    ]);
    expect(ids(rankModels({ rows, query: 'mini', recentModelKeys: recent })).slice(1)).toEqual([
      'OpenAI/gpt-4o-mini',
      'OpenAI/gpt-5-mini',
    ]);
  });

  it('filters by a provider name or alias token', () => {
    expect(ids(rankModels({ rows, query: 'openai mini' })).slice(0, 2)).toEqual([
      'OpenAI/gpt-5-mini',
      'OpenAI/gpt-4o-mini',
    ]);
    expect(ids(rankModels({ rows, query: 'bedrock' }))).toEqual([
      'AWS Bedrock/anthropic.claude-opus-5-5',
    ]);
    expect(ids(rankModels({ rows, query: 'grok' }))[0]).toBe('xAI/grok-4');
    // Aliases don't apply to custom providers, and short tokens never name a provider.
    expect(ids(rankModels({ rows, query: 'o3' }))).toEqual(['OpenAI/o3']);
  });

  it('lists every model of a whole-provider match, ranking word matches with the rest when a name is whole', () => {
    const openai = ids(rankModels({ rows, query: 'openai', limit: 0 }));

    // Curated first; a provider token alone keeps the server's order otherwise.
    expect(openai).toEqual([
      'OpenAI/gpt-6-sol',
      'OpenAI/gpt-5-mini',
      'OpenAI/gpt-4o-mini',
      'OpenAI/o3',
    ]);
    expect(ids(rankModels({ rows, query: 'azure', limit: 0 }))).toEqual(['Azure OpenAI/gpt-4o']);
  });

  it('caps model-name matches at the limit', () => {
    const many = buildCatalog({
      customProviders: [],
      playgroundModels: Array.from({ length: 12 }, (_, index) => ({
        providerKey: 'OPENAI' as const,
        name: `gpt-x-${index}`,
      })),
      providers,
    });

    expect(rankModels({ rows: many, query: 'gpt-x' })).toHaveLength(8);
    expect(rankModels({ rows: many, query: 'gpt-x', limit: 3 })).toHaveLength(3);
    // A whole provider name isn't capped.
    expect(rankModels({ rows: many, query: 'openai' })).toHaveLength(12);
  });
});

describe('inferProviderFromModelName', () => {
  it('guesses from prefixes, Bedrock ids first', () => {
    expect(inferProviderFromModelName('us.anthropic.claude-opus-5-5')).toBe('AWS');
    expect(inferProviderFromModelName('anthropic.claude-opus-5-5')).toBe('AWS');
    expect(inferProviderFromModelName('Claude-Opus-5-5')).toBe('ANTHROPIC');
    expect(inferProviderFromModelName('o4-mini')).toBe('OPENAI');
    expect(inferProviderFromModelName('gemini-3')).toBe('GOOGLE');
    expect(inferProviderFromModelName('kimi-k2')).toBe('MOONSHOT');
    expect(inferProviderFromModelName('glm-5')).toBe('ZAI');
    expect(inferProviderFromModelName('llama3.2:3b')).toBe('OLLAMA');
    expect(inferProviderFromModelName('my-deployment')).toBeNull();
    expect(inferProviderFromModelName(' ')).toBeNull();
  });
});

describe('customModelOption', () => {
  it('rejects empty and whitespace names, and needs providers', () => {
    expect(customModelOption('  ', providers)).toBeNull();
    expect(customModelOption('claude opus', providers)).toBeNull();
    expect(customModelOption('claude-x', [])).toBeNull();
  });

  it('offers the guessed provider first, then ready, may-work, and no-key ones', () => {
    const option = customModelOption(' grok-5 ', providers);

    expect(option?.modelName).toBe('grok-5');
    expect(option?.guessedProviderKey).toBe('XAI');
    expect(option?.providers.map((provider) => provider.name)).toEqual([
      'xAI',
      'OpenAI',
      'Anthropic',
      'Ollama',
      'Gateway',
      'Azure OpenAI',
      'AWS Bedrock',
      'MiniMax',
    ]);
  });

  it('offers names that are already listed, and has no guess for unknown names', () => {
    expect(customModelOption('gpt-6-sol', providers)?.guessedProviderKey).toBe('OPENAI');
    expect(customModelOption('my-deployment', providers)?.guessedProviderKey).toBeNull();
    // The guessed provider must be installed.
    expect(customModelOption('gemini-4', providers)?.guessedProviderKey).toBeNull();
  });

  it('notes custom providers, Azure deployment names, and the guess', () => {
    const [openai, azure] = providers;
    const gateway = providers.at(-1);

    expect(openai && customModelProviderNote(openai, true)).toBe('Guessed from the name');
    expect(openai && customModelProviderNote(openai, false)).toBeUndefined();
    expect(azure && customModelProviderNote(azure, false)).toBe('As a deployment name');
    expect(gateway && customModelProviderNote(gateway, false)).toBe('Custom provider');
  });
});

describe('addRecentModel', () => {
  const pick = (modelName: string): ModelSelection => ({
    providerType: 'builtin',
    provider: 'OPENAI',
    modelName,
  });

  it('moves a pick to the front, dedupes, and keeps five', () => {
    let recent: ModelSelection[] = [];

    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'c'])
      recent = addRecentModel(recent, pick(name));

    expect(recent.map((model) => model.modelName)).toEqual(['c', 'f', 'e', 'd', 'b']);
    expect(addRecentModel(recent, pick(''))).toEqual(recent);
  });
});

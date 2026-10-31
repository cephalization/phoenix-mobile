/**
 * Pure catalog and search logic for the PXI model picker, ported from
 * Phoenix's `agentModelSearch.ts`, `agentModelConfig.ts`, and
 * `agentCuratedModels.ts` (js/app/src/components/agent; synced with Phoenix
 * main on 2026-10-31): a flat catalog of every model PXI can run, token search
 * with ranking (a provider name in the query filters to that provider),
 * provider guessing for typed names, and the providers offered for a typed
 * custom model name. Everything works from server-side credential status:
 * PXI sends through the server, so only server keys make a provider usable.
 */
import type {
  BuiltInProvider,
  ModelSelection,
  PxiCredentialState,
  PxiModelCatalog,
  PxiModelRow,
  PxiProviderOption,
} from './types';

/** The models Phoenix recommends for PXI, in display order. */
export const CuratedModels: readonly {
  provider: BuiltInProvider;
  modelName: string;
  displayName: string;
}[] = [
  { provider: 'ANTHROPIC', modelName: 'claude-fable-5-1', displayName: 'Claude Fable 5.1' },
  { provider: 'ANTHROPIC', modelName: 'claude-opus-5-5', displayName: 'Claude Opus 5.5' },
  { provider: 'ANTHROPIC', modelName: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5' },
  { provider: 'OPENAI', modelName: 'gpt-6-sol', displayName: 'GPT-6 Sol' },
];

/** Phoenix's default PXI model (`DEFAULT_MODEL_MENU_VALUE`). */
export const DefaultModel: ModelSelection = {
  providerType: 'builtin',
  provider: 'ANTHROPIC',
  modelName: 'claude-opus-5-5',
};

/** How many recently picked models are kept per instance. */
export const RecentModelsLimit = 5;

/** How many recent models the picker shows. */
export const RecentModelsShown = 3;

const DefaultResultLimit = 8;

/**
 * Whether each built-in provider needs credentials (Phoenix's
 * `ProviderToCredentialsConfigMap`). The record is exhaustive over the
 * client's provider union, so it also tells a known provider key from an
 * unknown one a newer server might send.
 */
const ProviderRequiresCredentials: Record<BuiltInProvider, boolean> = {
  OPENAI: true,
  AZURE_OPENAI: true,
  ANTHROPIC: true,
  GOOGLE: true,
  DEEPSEEK: true,
  XAI: true,
  OLLAMA: false,
  AWS: true,
  CEREBRAS: true,
  FIREWORKS: true,
  GROQ: true,
  MOONSHOT: true,
  MINIMAX: true,
  PERPLEXITY: true,
  TOGETHER: true,
  ZAI: true,
  META: true,
};

/** Providers with an ambient credential chain the server can't detect. */
const DefaultCredentialChainProviders: ReadonlySet<BuiltInProvider> = new Set([
  'AWS',
  'AZURE_OPENAI',
]);

/** Custom provider SDKs and the built-in provider each speaks for. */
const SdkProviders = new Map<string, BuiltInProvider>([
  ['OPENAI', 'OPENAI'],
  ['AZURE_OPENAI', 'AZURE_OPENAI'],
  ['ANTHROPIC', 'ANTHROPIC'],
  ['AWS_BEDROCK', 'AWS'],
  ['GOOGLE_GENAI', 'GOOGLE'],
]);

export function isBuiltInProvider(value: string): value is BuiltInProvider {
  return Object.hasOwn(ProviderRequiresCredentials, value);
}

/** The built-in provider of a custom provider's SDK; OpenAI-compatible when unknown. */
export function providerForSdk(sdk: string): BuiltInProvider {
  return SdkProviders.get(sdk) ?? 'OPENAI';
}

/** The stable id of a provider: its key, or `custom:<id>` for a custom provider. */
export function providerKey(provider: string, customProviderId: string | null): string {
  return customProviderId ? `custom:${customProviderId}` : provider;
}

/** The stable id of a model selection, for row keys, recency, and comparison. */
export function modelKey(selection: ModelSelection): string {
  return selection.providerType === 'custom'
    ? `${providerKey('', selection.providerId)}:${selection.modelName}`
    : `${selection.provider}:${selection.modelName}`;
}

export function isSameModel(left: ModelSelection, right: ModelSelection): boolean {
  return modelKey(left) === modelKey(right);
}

function curatedModel(selection: ModelSelection) {
  if (selection.providerType === 'custom') return undefined;

  return CuratedModels.find(
    (model) => model.provider === selection.provider && model.modelName === selection.modelName,
  );
}

/** A built-in provider's credential state from server-side status only. */
export function credentialState(provider: {
  key: BuiltInProvider;
  credentialsSet: boolean;
}): PxiCredentialState {
  if (provider.credentialsSet || !ProviderRequiresCredentials[provider.key]) return 'ready';

  return DefaultCredentialChainProviders.has(provider.key) ? 'may-work' : 'no-key';
}

export type CatalogInput = {
  modelProviders: readonly {
    key: BuiltInProvider;
    name: string;
    dependenciesInstalled: boolean;
    credentialsSet: boolean;
  }[];
  playgroundModels: readonly { name: string; providerKey: BuiltInProvider }[];
  customProviders: readonly { id: string; name: string; sdk: string; modelNames: string[] }[];
};

/**
 * Every provider PXI can pick from: built-in providers with their server
 * dependencies installed (in server order), then custom providers, which are
 * always ready because their credentials live in their own server config.
 */
export function buildProviderOptions({
  customProviders,
  modelProviders,
}: Pick<CatalogInput, 'modelProviders' | 'customProviders'>): PxiProviderOption[] {
  const builtIn = modelProviders
    .filter((provider) => provider.dependenciesInstalled)
    .map((provider): PxiProviderOption => ({
      key: providerKey(provider.key, null),
      provider: provider.key,
      customProviderId: null,
      name: provider.name,
      credentialState: credentialState(provider),
    }));

  const custom = customProviders.map((provider): PxiProviderOption => ({
    key: providerKey('', provider.id),
    provider: providerForSdk(provider.sdk),
    customProviderId: provider.id,
    name: provider.name,
    credentialState: 'ready',
  }));

  return [...builtIn, ...custom];
}

/** The selection that sends a model name to a provider option. */
export function selectionFor(provider: PxiProviderOption, modelName: string): ModelSelection {
  return provider.customProviderId
    ? { providerType: 'custom', providerId: provider.customProviderId, modelName }
    : { providerType: 'builtin', provider: provider.provider, modelName };
}

function rowFor(
  provider: PxiProviderOption,
  modelName: string,
  isProviderMissing = false,
): PxiModelRow {
  const selection = selectionFor(provider, modelName);
  const curated = curatedModel(selection);

  return {
    key: modelKey(selection),
    selection,
    provider: provider.provider,
    customProviderId: provider.customProviderId,
    providerName: provider.name,
    modelName,
    isCurated: curated !== undefined,
    displayName: curated?.displayName ?? null,
    credentialState: provider.credentialState,
    isProviderMissing,
  };
}

/**
 * The flat catalog: built-in playground models, then each custom provider's
 * model names, for the providers in `providers` (so built-in providers without
 * their dependencies are left out). Rows keep the server's order.
 */
export function buildCatalog({
  customProviders,
  playgroundModels,
  providers,
}: Pick<CatalogInput, 'playgroundModels' | 'customProviders'> & {
  providers: readonly PxiProviderOption[];
}): PxiModelRow[] {
  const byKey = new Map(providers.map((option) => [option.key, option]));

  const builtIn = playgroundModels.flatMap((model) => {
    const option = byKey.get(providerKey(model.providerKey, null));

    return option ? [rowFor(option, model.name)] : [];
  });

  const custom = customProviders.flatMap((provider) => {
    const option = byKey.get(providerKey('', provider.id));

    return option ? provider.modelNames.map((name) => rowFor(option, name)) : [];
  });

  return [...builtIn, ...custom];
}

/** The curated models the catalog lists, in curated order. */
export function recommendedRows(rows: readonly PxiModelRow[]): PxiModelRow[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));

  return CuratedModels.flatMap((model) => {
    const row = byKey.get(`${model.provider}:${model.modelName}`);

    return row ? [row] : [];
  });
}

/**
 * The row for a selection that may not be in the catalog, such as the current
 * model or a recent typed name. A custom provider that's gone keeps the name
 * "Deleted provider" and is `no-key` with `isProviderMissing`; a built-in
 * provider that isn't installed is `no-key` too.
 */
export function resolveModelRow({
  model,
  providers,
  rows,
}: {
  model: ModelSelection;
  rows: readonly PxiModelRow[];
  providers: readonly PxiProviderOption[];
}): PxiModelRow {
  const key = modelKey(model);
  const catalogRow = rows.find((row) => row.key === key);

  if (catalogRow) return catalogRow;

  const option = providers.find((candidate) =>
    model.providerType === 'custom'
      ? candidate.customProviderId === model.providerId
      : candidate.customProviderId === null && candidate.provider === model.provider,
  );

  if (option) return rowFor(option, model.modelName);

  const missing: PxiProviderOption =
    model.providerType === 'custom'
      ? {
          key: providerKey('', model.providerId),
          provider: 'OPENAI',
          customProviderId: model.providerId,
          name: 'Deleted provider',
          credentialState: 'no-key',
        }
      : {
          key: model.provider,
          provider: model.provider,
          customProviderId: null,
          name: model.provider,
          credentialState: 'no-key',
        };

  return rowFor(missing, model.modelName, model.providerType === 'custom');
}

/**
 * Records a pick at the front of a recent-models list, dropping an earlier
 * entry for the same model and keeping at most `limit`. An empty model name
 * leaves the list as is.
 */
export function addRecentModel(
  recent: readonly ModelSelection[],
  model: ModelSelection,
  limit = RecentModelsLimit,
): ModelSelection[] {
  if (!model.modelName) return recent.slice(0, limit);
  const key = modelKey(model);

  return [model, ...recent.filter((entry) => modelKey(entry) !== key)].slice(0, limit);
}

/**
 * The model a new chat uses when nothing was chosen: Phoenix's default when
 * its provider is ready, else the first ready recommended model, else the
 * first ready model of any kind.
 */
export function defaultSelection(
  rows: readonly PxiModelRow[],
  recommended: readonly PxiModelRow[],
): ModelSelection | null {
  const ready = (row: PxiModelRow) => row.credentialState === 'ready';
  const defaultKey = modelKey(DefaultModel);

  return (
    recommended.find((row) => row.key === defaultKey && ready(row))?.selection ??
    recommended.find(ready)?.selection ??
    rows.find(ready)?.selection ??
    null
  );
}

// ---------------------------------------------------------------------------
// Search

/** Bedrock cross-region inference profile prefixes, as in `us.anthropic.claude-*`. */
const BedrockRegionPrefixes = ['apac', 'au', 'ca', 'eu', 'global', 'il', 'jp', 'us', 'us-gov'];

const BedrockRegionPattern = BedrockRegionPrefixes.join('|');

/** A `us.`-style region prefix, then a vendor or gateway segment (`anthropic.`, `acme/`). */
const LeadingNamespace = new RegExp(`^(?:(?:${BedrockRegionPattern})\\.)?[a-z]+[./]`);

/** Lowercase text without its Bedrock or gateway prefix, or all of it when that's all there is. */
function stripModelNamespace(text: string) {
  const lower = text.toLowerCase();

  return lower.replace(LeadingNamespace, '') || lower;
}

function normalizeWords(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function collapseSeparators(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function tokenizeQuery(query: string) {
  return query.trim().split(/\s+/).filter(Boolean);
}

/** Match-quality tiers returned by {@link tokenMatchScore}. */
export const MatchScore = {
  exact: 100,
  prefix: 70,
  substring: 50,
  tokens: 35,
  collapsed: 20,
} as const;

/**
 * How well a model name matches a query, or null for no match. In order:
 * exact or prefix (ignoring case and a Bedrock or gateway prefix on either
 * side), substring, every token starting a word of the name (`opus 5`), then
 * the query inside the name with separators removed (`opus5`).
 */
export function tokenMatchScore(name: string, query: string): number | null {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) return null;
  const lowerName = name.toLowerCase();
  const bareName = stripModelNamespace(lowerName);
  const bareQuery = stripModelNamespace(normalizedQuery);

  if (lowerName === normalizedQuery || bareName === bareQuery) return MatchScore.exact;

  if (lowerName.startsWith(normalizedQuery) || bareName.startsWith(bareQuery)) {
    return MatchScore.prefix;
  }

  if (lowerName.includes(bareQuery)) return MatchScore.substring;
  const tokens = normalizeWords(bareQuery).split(' ').filter(Boolean);
  const words = normalizeWords(name).split(' ');

  if (tokens.length > 0 && tokens.every((token) => words.some((word) => word.startsWith(token)))) {
    return MatchScore.tokens;
  }

  const collapsedQuery = collapseSeparators(bareQuery);

  if (collapsedQuery && collapseSeparators(name).includes(collapsedQuery)) {
    return MatchScore.collapsed;
  }

  return null;
}

/** Best match of a row's id and, for curated rows, its display name. */
function rowNameScore(row: PxiModelRow, query: string): number | null {
  const idScore = tokenMatchScore(row.modelName, query);
  const displayScore = row.displayName ? tokenMatchScore(row.displayName, query) : null;

  if (idScore === null) return displayScore;

  return Math.max(idScore, displayScore ?? idScore);
}

/** Extra words that name a built-in provider in search. */
const ProviderSearchAliases: Partial<Record<BuiltInProvider, readonly string[]>> = {
  AWS: ['bedrock', 'amazon'],
  GOOGLE: ['gemini'],
  XAI: ['grok'],
  MOONSHOT: ['kimi'],
};

/** Shortest token that can name a provider, so `o3` or `gp` never filter by provider. */
const MinProviderTermLength = 3;

/**
 * How a token names a provider: `name` (the whole name ignoring separators,
 * or an alias), `word` (one whole word of the name), or `prefix`.
 */
type ProviderTermMatch = 'name' | 'word' | 'prefix';

type ProviderTarget = Pick<PxiModelRow, 'providerName' | 'provider' | 'customProviderId'>;

/** Aliases apply to built-in providers only. */
function matchProviderTerm(target: ProviderTarget, term: string): ProviderTermMatch | null {
  const normalizedTerm = collapseSeparators(term);

  if (normalizedTerm.length < MinProviderTermLength) return null;
  const collapsedName = collapseSeparators(target.providerName);
  const aliases = target.customProviderId ? [] : (ProviderSearchAliases[target.provider] ?? []);

  if (collapsedName === normalizedTerm || aliases.includes(normalizedTerm)) return 'name';
  const words = normalizeWords(target.providerName).split(' ');

  if (words.includes(normalizedTerm)) return 'word';

  return [collapsedName, ...words, ...aliases].some((word) => word.startsWith(normalizedTerm))
    ? 'prefix'
    : null;
}

/** Ranking tiers, highest first; see Phoenix's `MATCH_TIER`. */
const MatchTier = { providerName: 3, providerWord: 2, model: 1 } as const;

const ProviderMatchTier: Record<ProviderTermMatch, number> = {
  name: MatchTier.providerName,
  word: MatchTier.providerWord,
  prefix: MatchTier.model,
};

type RowMatch = { tier: number; score: number };

/**
 * A row's best match: its names against the whole query, or its provider
 * against one token with its names against the rest. A provider token alone
 * scores 0 for a whole name or word and a prefix score for a partial one.
 */
function rowMatch(
  row: PxiModelRow,
  query: string,
  tokens: readonly string[],
  isProviderNameInQuery: boolean,
): RowMatch | null {
  const nameScore = rowNameScore(row, query);

  let best: RowMatch | null =
    nameScore === null ? null : { tier: MatchTier.model, score: nameScore };

  tokens.forEach((token, tokenIndex) => {
    const providerMatch = matchProviderTerm(row, token);

    if (!providerMatch) return;
    const rest = tokens.filter((_, index) => index !== tokenIndex).join(' ');

    const score = rest
      ? rowNameScore(row, rest)
      : providerMatch === 'prefix'
        ? MatchScore.prefix
        : 0;

    if (score === null) return;

    const tier =
      providerMatch === 'word' && isProviderNameInQuery
        ? MatchTier.model
        : ProviderMatchTier[providerMatch];

    if (!best || tier > best.tier || (tier === best.tier && score > best.score)) {
      best = { tier, score };
    }
  });

  return best;
}

const CredentialOrder: Record<PxiCredentialState, number> = {
  ready: 0,
  'may-work': 1,
  'no-key': 2,
};

/**
 * Searches and ranks the catalog. A token naming a provider (`openai`,
 * `bedrock`, `anth`) filters to that provider, matching the other tokens
 * against model names. Rows sort by match tier, match quality, curated first,
 * credential state, recency, the shorter id (unless only a provider matched),
 * then catalog order. Whole provider-name or word matches aren't capped;
 * `limit` caps the rows after them. An empty query returns nothing.
 */
export function rankModels({
  limit = DefaultResultLimit,
  query,
  recentModelKeys = [],
  rows,
}: {
  rows: readonly PxiModelRow[];
  query: string;
  recentModelKeys?: readonly string[];
  limit?: number;
}): PxiModelRow[] {
  const trimmed = query.trim();
  const tokens = tokenizeQuery(trimmed);

  if (tokens.length === 0) return [];
  const recency = new Map(recentModelKeys.map((key, index) => [key, index]));

  const providerTargets = [
    ...new Map(rows.map((row) => [providerKey(row.provider, row.customProviderId), row])).values(),
  ];

  const isProviderNameInQuery = providerTargets.some((target) =>
    tokens.some((token) => matchProviderTerm(target, token) === 'name'),
  );

  const scored = rows.flatMap((row, catalogIndex) => {
    const match = rowMatch(row, trimmed, tokens, isProviderNameInQuery);

    return match
      ? [
          {
            row,
            tier: match.tier,
            score: match.score,
            recency: recency.get(row.key) ?? recentModelKeys.length,
            catalogIndex,
          },
        ]
      : [];
  });

  scored.sort(
    (first, second) =>
      second.tier - first.tier ||
      second.score - first.score ||
      Number(second.row.isCurated) - Number(first.row.isCurated) ||
      CredentialOrder[first.row.credentialState] - CredentialOrder[second.row.credentialState] ||
      first.recency - second.recency ||
      (first.score > 0 ? first.row.modelName.length - second.row.modelName.length : 0) ||
      first.catalogIndex - second.catalogIndex,
  );

  const providerMatches = scored.filter(({ tier }) => tier >= MatchTier.providerWord).length;

  return scored.slice(0, providerMatches + limit).map(({ row }) => row);
}

/** Prefix rules for guessing a typed name's provider, checked in order. */
const ProviderNamePatterns: readonly { pattern: RegExp; provider: BuiltInProvider }[] = [
  {
    pattern: new RegExp(
      `^(?:${BedrockRegionPattern})\\.|^(?:anthropic|amazon|meta|mistral|cohere|deepseek)\\.[a-z]`,
    ),
    provider: 'AWS',
  },
  { pattern: /^claude/, provider: 'ANTHROPIC' },
  { pattern: /^(gpt|chatgpt|o\d)/, provider: 'OPENAI' },
  { pattern: /^gemini/, provider: 'GOOGLE' },
  { pattern: /^grok/, provider: 'XAI' },
  { pattern: /^deepseek/, provider: 'DEEPSEEK' },
  { pattern: /^(kimi|moonshot)/, provider: 'MOONSHOT' },
  { pattern: /^glm/, provider: 'ZAI' },
  { pattern: /^minimax/, provider: 'MINIMAX' },
  { pattern: /^sonar/, provider: 'PERPLEXITY' },
  // `llama3.2:3b`-style tags are Ollama's.
  { pattern: /^[a-z][a-z0-9.-]*:[a-z0-9.]+$/, provider: 'OLLAMA' },
];

/** Guesses a typed model name's built-in provider from its prefix, or null. */
export function inferProviderFromModelName(modelName: string): BuiltInProvider | null {
  const normalized = modelName.trim().toLowerCase();

  if (!normalized) return null;

  return ProviderNamePatterns.find(({ pattern }) => pattern.test(normalized))?.provider ?? null;
}

export type CustomModelOption = {
  modelName: string;
  /** The guessed provider first, then ready, may-work, and no-key ones in provider order. */
  providers: PxiProviderOption[];
  /** Key of the provider guessed from the name, when it's offered. */
  guessedProviderKey: string | null;
};

/**
 * The query as a custom model name with the providers to offer it to, or null
 * when the query is empty, contains whitespace (no model id does), or there
 * are no providers. A name that matches a listed id is still offered, since
 * the same id can go to another provider.
 */
export function customModelOption(
  query: string,
  providers: readonly PxiProviderOption[],
): CustomModelOption | null {
  const modelName = query.trim();

  if (!modelName || /\s/.test(modelName) || providers.length === 0) return null;
  const guessedKey = inferProviderFromModelName(modelName);

  const guessed = guessedKey
    ? (providers.find(
        (option) => option.customProviderId === null && option.provider === guessedKey,
      ) ?? null)
    : null;

  const others = providers
    .filter((option) => option !== guessed)
    .sort(
      (first, second) =>
        CredentialOrder[first.credentialState] - CredentialOrder[second.credentialState],
    );

  return {
    modelName,
    providers: guessed ? [guessed, ...others] : others,
    guessedProviderKey: guessed?.key ?? null,
  };
}

/** A provider's second line in the custom-model provider list. */
export function customModelProviderNote(
  option: PxiProviderOption,
  isGuessed: boolean,
): string | undefined {
  if (option.customProviderId) return 'Custom provider';

  if (option.provider === 'AZURE_OPENAI') return 'As a deployment name';

  return isGuessed ? 'Guessed from the name' : undefined;
}

/**
 * The model unless its custom provider was deleted. Phoenix accepts any model
 * name on a live provider, so a typed name stays usable; a bad one fails when
 * a turn runs.
 */
export function availableModel(
  catalog: Pick<PxiModelCatalog, 'providers' | 'rows'>,
  model: ModelSelection | null | undefined,
): ModelSelection | undefined {
  if (!model) return undefined;

  return resolveModelRow({ model, providers: catalog.providers, rows: catalog.rows })
    .isProviderMissing
    ? undefined
    : model;
}

/** A model's curated display name, or its id; custom and typed names show as typed. */
export function modelDisplayName(model: ModelSelection): string {
  return curatedModel(model)?.displayName ?? model.modelName;
}

import { useQuery } from '@tanstack/react-query';
import { fetch as expoFetch } from 'expo/fetch';

import type { PhoenixInstance } from '@/types/instance';

import { buildInstanceHeaders } from './client';
import type {
  BuiltInProvider,
  ModelSelection,
  PxiModelCatalog,
  PxiModelOption,
} from './types';

const MODEL_PREFLIGHT_QUERY = `
  query PxiModelPreflightQuery {
    modelProviders {
      key
      name
      dependenciesInstalled
      credentialsSet
      credentialRequirements { envVarName isRequired }
    }
    playgroundModels { providerKey name }
    generativeModelCustomProviders(first: 50) {
      edges { node { id name sdk modelNames } }
    }
  }
`;

const MODEL_PREFLIGHT_TIMEOUT_MS = 10_000;

const CURATED_MODELS = [
  ['ANTHROPIC', 'claude-fable-5'],
  ['ANTHROPIC', 'claude-opus-4-8'],
  ['ANTHROPIC', 'claude-opus-4-6'],
  ['ANTHROPIC', 'claude-sonnet-4-6'],
  ['OPENAI', 'gpt-5.6-sol'],
  ['OPENAI', 'gpt-5.4'],
  ['OPENAI', 'gpt-5.4-mini'],
  ['OPENAI', 'gpt-5.5'],
  ['GOOGLE', 'gemini-3.1-pro-preview'],
  ['GOOGLE', 'gemini-3.5-flash'],
] as const;

type ModelPreflightResponse = {
  data?: {
    modelProviders: {
      key: BuiltInProvider;
      name: string;
      dependenciesInstalled: boolean;
      credentialsSet: boolean;
    }[];
    playgroundModels: { providerKey: BuiltInProvider; name: string }[];
    generativeModelCustomProviders: {
      edges: {
        node: { id: string; name: string; sdk: string; modelNames: string[] };
      }[];
    };
  };
  errors?: { message?: string }[];
};

function modelId(selection: ModelSelection): string {
  return selection.providerType === 'custom'
    ? `custom:${selection.providerId}/${selection.modelName}`
    : `${selection.provider}/${selection.modelName}`;
}

export function isSameModel(left: ModelSelection, right: ModelSelection): boolean {
  return modelId(left) === modelId(right);
}

export async function fetchPxiModelCatalog(
  instance: PhoenixInstance,
  querySignal?: AbortSignal
): Promise<PxiModelCatalog> {
  const controller = new AbortController();
  let timedOut = false;
  const abortForQuery = () => controller.abort();
  querySignal?.addEventListener('abort', abortForQuery);
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, MODEL_PREFLIGHT_TIMEOUT_MS);

  let response: Awaited<ReturnType<typeof expoFetch>>;
  try {
    response = await expoFetch(`${instance.baseUrl.replace(/\/+$/, '')}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...buildInstanceHeaders(instance) },
      body: JSON.stringify({ query: MODEL_PREFLIGHT_QUERY }),
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) throw new Error('Phoenix model discovery timed out. Check the instance address and network.');
    throw error;
  } finally {
    clearTimeout(timeout);
    querySignal?.removeEventListener('abort', abortForQuery);
  }

  if (!response.ok) throw new Error(`Phoenix model discovery failed with HTTP ${response.status}.`);
  const payload = (await response.json()) as ModelPreflightResponse;
  if (!payload.data) {
    const detail = payload.errors?.map((error) => error.message).filter(Boolean).join(' ');
    throw new Error(detail || 'Phoenix returned no model catalog.');
  }

  const providerNames = new Map(payload.data.modelProviders.map((provider) => [provider.key, provider.name]));
  const usableProviders = new Set(
    payload.data.modelProviders
      .filter((provider) => provider.dependenciesInstalled && provider.credentialsSet)
      .map((provider) => provider.key)
  );
  const curatedIds = new Set(CURATED_MODELS.map(([provider, name]) => `${provider}/${name}`));
  const options: PxiModelOption[] = payload.data.playgroundModels
    .filter((model) => usableProviders.has(model.providerKey))
    .map((model) => {
      const selection: ModelSelection = {
        providerType: 'builtin',
        provider: model.providerKey,
        modelName: model.name,
      };
      return {
        id: modelId(selection),
        label: model.name,
        providerLabel: providerNames.get(model.providerKey) ?? model.providerKey,
        selection,
        recommended: curatedIds.has(`${model.providerKey}/${model.name}`),
      };
    });

  for (const { node } of payload.data.generativeModelCustomProviders.edges) {
    for (const modelName of node.modelNames) {
      const selection: ModelSelection = {
        providerType: 'custom',
        providerId: node.id,
        modelName,
      };
      options.push({
        id: modelId(selection),
        label: modelName,
        providerLabel: node.name,
        selection,
        recommended: false,
      });
    }
  }

  const curatedOrder = new Map(CURATED_MODELS.map(([provider, name], index) => [`${provider}/${name}`, index]));
  options.sort((left, right) => {
    const leftRank = curatedOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = curatedOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return `${left.providerLabel}/${left.label}`.localeCompare(`${right.providerLabel}/${right.label}`);
  });

  return { options, defaultSelection: options[0]?.selection ?? null };
}

export function usePxiModelCatalog(instance: PhoenixInstance | undefined) {
  return useQuery({
    queryKey: ['pxi', 'models', instance?.id ?? 'missing'],
    queryFn: ({ signal }) => {
      if (!instance) throw new Error('Phoenix instance not found.');
      return fetchPxiModelCatalog(instance, signal);
    },
    enabled: Boolean(instance),
    retry: false,
    staleTime: 60_000,
  });
}

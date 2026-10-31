import { useQuery } from '@tanstack/react-query';

import {
  isJsonArray,
  isJsonBoolean,
  isJsonObject,
  isJsonString,
  type JsonObject,
  type JsonValue,
} from '@/lib/json';
import { phoenixGraphQL } from '@/lib/phoenix-graphql';
import type { PhoenixInstance } from '@/types/instance';

import {
  buildCatalog,
  buildProviderOptions,
  type CatalogInput,
  defaultSelection,
  isBuiltInProvider,
  recommendedRows,
} from './model-search';
import type { PxiModelCatalog } from './types';

// Phoenix's `useModelMenuData` query: every built-in provider with its server
// status, the playground's model list, and the custom providers. The server
// accepts any model name for either kind (Phoenix 20.0.0+).
const MODEL_CATALOG_QUERY = `
  query PxiModelCatalogQuery {
    modelProviders { key name dependenciesInstalled credentialsSet }
    playgroundModels { name providerKey }
    generativeModelCustomProviders(first: 50) {
      edges { node { id name sdk modelNames } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const CUSTOM_PROVIDERS_PAGE_QUERY = `
  query PxiCustomProvidersPageQuery($after: String) {
    generativeModelCustomProviders(first: 50, after: $after) {
      edges { node { id name sdk modelNames } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/** A defensive bound on custom-provider pages (50 each). */
const MAX_CUSTOM_PROVIDER_PAGES = 20;

export { isSameModel } from './model-search';

export async function fetchPxiModelCatalog(
  instance: PhoenixInstance,
  signal?: AbortSignal,
): Promise<PxiModelCatalog> {
  const data = await phoenixGraphQL(instance, MODEL_CATALOG_QUERY, { signal });
  const customProviders: CatalogInput['customProviders'][number][] = [];
  let page = readCustomProviderPage(data);

  customProviders.push(...page.providers);

  for (let pages = 1; page.endCursor !== null && pages < MAX_CUSTOM_PROVIDER_PAGES; pages += 1) {
    const next = await phoenixGraphQL(instance, CUSTOM_PROVIDERS_PAGE_QUERY, {
      signal,
      variables: { after: page.endCursor },
    });

    page = readCustomProviderPage(next);
    customProviders.push(...page.providers);
  }

  const input: CatalogInput = {
    modelProviders: arrayField(data, 'modelProviders').flatMap((provider) =>
      isJsonObject(provider) &&
      isJsonString(provider.key) &&
      isBuiltInProvider(provider.key) &&
      isJsonString(provider.name) &&
      isJsonBoolean(provider.dependenciesInstalled) &&
      isJsonBoolean(provider.credentialsSet)
        ? [
            {
              key: provider.key,
              name: provider.name,
              dependenciesInstalled: provider.dependenciesInstalled,
              credentialsSet: provider.credentialsSet,
            },
          ]
        : [],
    ),
    playgroundModels: arrayField(data, 'playgroundModels').flatMap((model) =>
      isJsonObject(model) &&
      isJsonString(model.name) &&
      isJsonString(model.providerKey) &&
      isBuiltInProvider(model.providerKey)
        ? [{ name: model.name, providerKey: model.providerKey }]
        : [],
    ),
    customProviders,
  };

  const providers = buildProviderOptions(input);
  const rows = buildCatalog({ ...input, providers });
  const recommended = recommendedRows(rows);

  return { providers, rows, recommended, defaultSelection: defaultSelection(rows, recommended) };
}

function arrayField(data: JsonObject, field: string): JsonValue[] {
  const value = data[field];

  return isJsonArray(value) ? value : [];
}

/** One page of the custom-provider connection; `endCursor` is null on the last page. */
type CustomProviderPage = {
  providers: CatalogInput['customProviders'];
  endCursor: string | null;
};

function readCustomProviderPage(data: JsonObject): CustomProviderPage {
  const connection = data.generativeModelCustomProviders;

  if (!isJsonObject(connection)) return { providers: [], endCursor: null };
  const edges = isJsonArray(connection.edges) ? connection.edges : [];

  const providers = edges.flatMap((edge) => {
    const node = isJsonObject(edge) ? edge.node : null;

    if (
      !isJsonObject(node) ||
      !isJsonString(node.id) ||
      !isJsonString(node.name) ||
      !isJsonString(node.sdk)
    ) {
      return [];
    }

    const modelNames = isJsonArray(node.modelNames) ? node.modelNames.filter(isJsonString) : [];

    return [{ id: node.id, name: node.name, sdk: node.sdk, modelNames }];
  });

  const pageInfo = connection.pageInfo;

  const endCursor =
    isJsonObject(pageInfo) && pageInfo.hasNextPage === true && isJsonString(pageInfo.endCursor)
      ? pageInfo.endCursor
      : null;

  return { providers, endCursor };
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

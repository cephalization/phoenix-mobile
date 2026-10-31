import { authenticatedFetch, getAuthorizationHeaders } from '@/features/auth/session';
import {
  isJsonArray,
  isJsonObject,
  isJsonString,
  type JsonObject,
  type JsonValue,
} from '@/lib/json';
import type { PhoenixInstance } from '@/types/instance';

const DefaultTimeoutMs = 10_000;

export class PhoenixGraphQLError extends Error {
  override name = 'PhoenixGraphQLError';
}

/**
 * Posts one GraphQL operation to an instance's `/graphql` endpoint and returns
 * its `data` as JSON for the caller to narrow with the predicates in
 * `src/lib/json.ts`. REST has no equivalent for project statistics, filter
 * validation, filter vocabularies, or the model catalog, so those go here.
 * Throws `PhoenixGraphQLError` with the server's messages when there is no data.
 */
export async function phoenixGraphQL(
  instance: PhoenixInstance,
  query: string,
  {
    signal,
    timeoutMs = DefaultTimeoutMs,
    variables,
  }: { variables?: JsonObject; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<JsonObject> {
  const controller = new AbortController();
  let timedOut = false;
  const abortForCaller = () => controller.abort();
  signal?.addEventListener('abort', abortForCaller);

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let response: Response;

  try {
    response = await authenticatedFetch(
      instance,
      `${instance.baseUrl.replace(/\/+$/, '')}/graphql`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(await getAuthorizationHeaders(instance)),
        },
        body: JSON.stringify(variables === undefined ? { query } : { query, variables }),
        signal: controller.signal,
      },
      true,
    );
  } catch (error) {
    if (timedOut) {
      throw new PhoenixGraphQLError('Phoenix did not answer in time. Check the network.', {
        cause: error,
      });
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortForCaller);
  }

  if (!response.ok) throw new PhoenixGraphQLError(`Phoenix returned HTTP ${response.status}.`);
  const payload: JsonValue = await response.json();

  if (isJsonObject(payload) && isJsonObject(payload.data)) return payload.data;

  throw new PhoenixGraphQLError(graphQLErrorMessage(payload) ?? 'Phoenix returned no data.');
}

function graphQLErrorMessage(payload: JsonValue): string | null {
  if (!isJsonObject(payload) || !isJsonArray(payload.errors)) return null;

  const messages = payload.errors.flatMap((error) =>
    isJsonObject(error) && isJsonString(error.message) ? [error.message] : [],
  );

  return messages.length > 0 ? messages.join(' ') : null;
}

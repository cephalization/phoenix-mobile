import type { TraceFilterVocabularyTerm } from '@/features/traces/filter';
import type { TraceFilterVerdict } from '@/features/traces/filter-ai';
import { isJsonArray, isJsonBoolean, isJsonObject, isJsonString, type JsonValue } from '@/lib/json';
import { PhoenixGraphQLError, phoenixGraphQL } from '@/lib/phoenix-graphql';
import type { PhoenixInstance } from '@/types/instance';

/**
 * `filter` expressions on the REST trace list shipped in Phoenix 20.12.0. The
 * GraphQL `validateTraceFilterCondition` and `traceFilterVocabulary` fields
 * are older (20.3.0), so this one floor gates the whole feature.
 */
export const TraceFilterExpressionsMinimum = [20, 12, 0] as const;

/** Phoenix's OpenAI-compatible `/v1/chat/completions` proxy shipped in 19.16.0. */
export const ChatCompletionsMinimum = [19, 16, 0] as const;

/** The server rejected the user's expression; `message` is Phoenix's own text. */
export class TraceFilterExpressionError extends Error {
  override name = 'TraceFilterExpressionError';
}

const ValidateQuery = `
  query MobileValidateTraceFilter($projectId: ID!, $condition: String!) {
    node(id: $projectId) {
      ... on Project {
        validateTraceFilterCondition(condition: $condition) { isValid errorMessage warnings }
      }
    }
  }
`;

const VocabularyQuery = `
  query MobileTraceFilterVocabulary($projectId: ID!, $timeRange: TimeRange) {
    node(id: $projectId) {
      ... on Project {
        traceFilterVocabulary(timeRange: $timeRange) { name type description category iterableName }
      }
    }
  }
`;

/**
 * Compiles a condition on the server without running it. Null when the
 * server has no validator, so callers fall back to the trace list's 400.
 */
export async function validateTraceFilterCondition(
  instance: PhoenixInstance,
  projectId: string,
  condition: string,
  signal?: AbortSignal,
): Promise<TraceFilterVerdict | null> {
  let data;

  try {
    data = await phoenixGraphQL(instance, ValidateQuery, {
      signal,
      variables: { condition, projectId },
    });
  } catch (error) {
    if (error instanceof PhoenixGraphQLError && isMissingField(error)) return null;
    throw error;
  }

  const result = isJsonObject(data.node) ? data.node.validateTraceFilterCondition : undefined;

  if (!isJsonObject(result) || !isJsonBoolean(result.isValid)) return null;

  return {
    isValid: result.isValid,
    errorMessage: isJsonString(result.errorMessage) ? result.errorMessage : null,
    warnings: isJsonArray(result.warnings) ? result.warnings.filter(isJsonString) : [],
  };
}

/**
 * The project's filter vocabulary: the compiler's static terms plus
 * annotation names and root attribute keys observed in the range. Empty on
 * servers without the field.
 */
export async function fetchTraceFilterVocabulary(
  instance: PhoenixInstance,
  projectId: string,
  range: { startTime: string; endTime: string },
  signal?: AbortSignal,
): Promise<TraceFilterVocabularyTerm[]> {
  let data;

  try {
    data = await phoenixGraphQL(instance, VocabularyQuery, {
      signal,
      variables: { projectId, timeRange: { start: range.startTime, end: range.endTime } },
    });
  } catch (error) {
    if (error instanceof PhoenixGraphQLError && isMissingField(error)) return [];
    throw error;
  }

  const terms = isJsonObject(data.node) ? data.node.traceFilterVocabulary : undefined;

  return isJsonArray(terms) ? terms.flatMap(vocabularyTerm) : [];
}

function vocabularyTerm(value: JsonValue): TraceFilterVocabularyTerm[] {
  if (!isJsonObject(value) || !isJsonString(value.name) || !isJsonString(value.type)) return [];

  return [
    {
      name: value.name,
      type: value.type,
      description: isJsonString(value.description) ? value.description : '',
      category: isJsonString(value.category) ? value.category : '',
      iterableName: isJsonString(value.iterableName) ? value.iterableName : null,
    },
  ];
}

/** Strawberry answers an unknown field with "Cannot query field … on type …". */
function isMissingField(error: PhoenixGraphQLError) {
  return /cannot query field/i.test(error.message);
}

import { useState } from 'react';

import { ChatCompletionsMinimum } from '@/features/traces/filter-api';
import {
  chatCompletionsModelId,
  flattenTraceFilterMessages,
  type TraceFilterModel,
} from '@/features/traces/filter-ai';
import type { ModelSelection } from '@/features/pxi/types';
import { usePhoenixVersionAtLeast } from '@/hooks/use-phoenix-data';
import { isJsonObject, isJsonString, isJsonValue, type JsonValue } from '@/lib/json';
import { createPhoenixClient } from '@/lib/phoenix';
import { useInstanceStore } from '@/store/instances';
import type { PhoenixInstance } from '@/types/instance';

import {
  generateOnDevice,
  onDeviceModelAvailability,
  OnDeviceModelError,
} from '../../../modules/on-device-llm';

/** Room for brief reasoning plus a long expression; the answer format keeps it short. */
const OnDeviceResponseTokens = 320;

const ServerTimeoutMs = 60_000;

/** The model that turns plain language into a filter, and how to describe where it runs. */
export type TraceFilterAssistant = {
  kind: 'onDevice' | 'server';
  /** "On device", or "Using <model> on <instance>". */
  label: string;
  model: TraceFilterModel;
};

/**
 * Picks Ask's model: Apple's on-device model when it is ready (private, free,
 * offline), otherwise the instance's selected PXI model through Phoenix's
 * chat completions proxy. Null when neither is available, which hides Ask.
 */
export function useTraceFilterAssistant(
  instance: PhoenixInstance | undefined,
): TraceFilterAssistant | null {
  // Availability is synchronous and changes only with system settings.
  const [onDeviceReady] = useState(() => onDeviceModelAvailability() === 'available');

  const selection = useInstanceStore((state) =>
    instance ? state.pxiModels[instance.id] : undefined,
  );

  const proxySupported = usePhoenixVersionAtLeast(instance, ChatCompletionsMinimum);

  if (onDeviceReady) return { kind: 'onDevice', label: 'On device', model: onDeviceModel };

  if (instance && selection && proxySupported === true) {
    return {
      kind: 'server',
      label: `Using ${selection.modelName} on ${instance.name}`,
      model: serverModel(instance, selection),
    };
  }

  return null;
}

const onDeviceModel: TraceFilterModel = {
  profile: 'compact',
  complete: async ({ instructions, messages }) => {
    try {
      return await generateOnDevice({
        instructions,
        prompt: flattenTraceFilterMessages(messages),
        maximumResponseTokens: OnDeviceResponseTokens,
      });
    } catch (error) {
      if (error instanceof OnDeviceModelError)
        throw new Error(onDeviceMessage(error), { cause: error });
      throw error;
    }
  },
};

function onDeviceMessage(error: OnDeviceModelError) {
  switch (error.code) {
    case 'guardrail':
      return 'Apple Intelligence declined this request. Try wording it differently.';
    case 'contextWindow':
      return 'This request is too long for the on-device model. Try a shorter one.';
    case 'unsupportedLanguage':
      return 'The on-device model does not support this language.';
    case 'rateLimited':
    case 'busy':
      return 'The on-device model is busy. Try again in a moment.';
    case 'unavailable':
      return 'Apple Intelligence is not available right now.';
    case 'failed':
      return error.message || 'The on-device model could not write a filter.';
  }
}

function serverModel(instance: PhoenixInstance, selection: ModelSelection): TraceFilterModel {
  return {
    profile: 'full',
    complete: async ({ instructions, messages, signal }) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      const timeout = setTimeout(abort, ServerTimeoutMs);
      signal?.addEventListener('abort', abort);

      try {
        const client = await createPhoenixClient(instance);

        const response = await client.POST('/v1/chat/completions', {
          body: {
            model: chatCompletionsModelId(selection),
            messages: [{ role: 'system', content: instructions }, ...messages],
            stream: false,
          },
          signal: controller.signal,
        });

        const content = response.data?.choices[0]?.message.content;

        if (content !== undefined) return content;

        throw new Error(
          chatCompletionError(isJsonValue(response.error) ? response.error : null) ??
            'Phoenix could not reach the model.',
        );
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}

/** The proxy answers failures in OpenAI's `{ error: { message } }` shape. */
function chatCompletionError(error: JsonValue) {
  if (isJsonString(error)) return error.trim() || null;

  if (!isJsonObject(error)) return null;

  const detail = error.error;

  return isJsonObject(detail) && isJsonString(detail.message) ? detail.message : null;
}

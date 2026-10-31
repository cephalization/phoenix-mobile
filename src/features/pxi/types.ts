import type { Types } from '@arizeai/phoenix-client';
import type { UIMessage } from 'ai';

// Phoenix namespaces UIMessage metadata; assistant turns carry their trace
// identity under `phoenix.turnTraceContext`.
export type AssistantMessageMetadata = {
  phoenix?: {
    type: 'assistant' | 'user';
    sessionId?: string;
    turnTraceContext?: {
      traceId: string;
      rootSpanId: string;
    } | null;
    usage?: {
      tokens: {
        prompt: number;
        completion: number;
        total: number;
      };
    } | null;
  } | null;
};

export type PxiMessage = UIMessage<AssistantMessageMetadata>;

export type BuiltInProvider = Types['V1']['components']['schemas']['ModelProvider'];

export type ModelSelection =
  | {
      providerType: 'builtin';
      provider: BuiltInProvider;
      modelName: string;
    }
  | {
      providerType: 'custom';
      providerId: string;
      modelName: string;
    };

export type PxiContext =
  | { type: 'app'; currentDateTime: string; timeZone: string }
  | { type: 'web_access'; enabled: boolean }
  | { type: 'subagents'; enabled: boolean }
  | { type: 'session'; projectNodeId: string; sessionNodeId: string };

export type PxiChatRequest = {
  id: string;
  trigger: 'submit-message';
  /** Phoenix Mobile drives the headless server agent, not the browser assistant. */
  headless: true;
  recordLocalTraces: true;
  exportRemoteTraces: false;
  instrumentUserId: false;
  editPermission: 'manual';
  contexts: PxiContext[];
  /** Asserted against the session's persisted model; a mismatch is HTTP 409 `agent_session_model_stale`. */
  model: ModelSelection;
  /** The turn's new trailing user message. */
  message: PxiMessage;
  /** Optimistic-concurrency token: the persisted transcript's tail message id, or null when empty. */
  lastMessageId: string | null;
};

/**
 * Whether PXI can authenticate with a provider, from server-side status only:
 * - `ready`: credentials are set on the server, or none are needed
 * - `may-work`: none are set, but the provider can use an ambient credential
 *   chain the server can't detect (AWS, Azure)
 * - `no-key`: credentials are required and missing
 */
export type PxiCredentialState = 'ready' | 'may-work' | 'no-key';

/** A provider models can be sent to: a built-in one or a custom one. */
export type PxiProviderOption = {
  /** Stable id: the provider key, or `custom:<id>` for a custom provider. */
  key: string;
  /** The built-in provider; for a custom provider, the provider of its SDK. */
  provider: BuiltInProvider;
  /** The custom provider's GlobalID, or null for a built-in provider. */
  customProviderId: string | null;
  name: string;
  credentialState: PxiCredentialState;
};

/** One pickable model. */
export type PxiModelRow = {
  /** Stable id, see `modelKey` in `model-search.ts`. */
  key: string;
  selection: ModelSelection;
  provider: BuiltInProvider;
  customProviderId: string | null;
  providerName: string;
  modelName: string;
  /** On Phoenix's Recommended list. */
  isCurated: boolean;
  /** The curated display name, or null to show the raw id. */
  displayName: string | null;
  credentialState: PxiCredentialState;
  /** A resolved selection whose custom provider no longer exists. Catalog rows never set it. */
  isProviderMissing: boolean;
};

export type PxiModelCatalog = {
  /** Installed built-in providers in server order, then custom providers. */
  providers: PxiProviderOption[];
  /** Built-in playground models, then each custom provider's model names. */
  rows: PxiModelRow[];
  /** The curated models the server lists, in Phoenix's order. */
  recommended: PxiModelRow[];
  /** The model a new chat uses when nothing was chosen, or null when no provider is ready. */
  defaultSelection: ModelSelection | null;
};

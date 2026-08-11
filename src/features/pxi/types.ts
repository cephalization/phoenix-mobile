import type { UIMessage } from 'ai';

export type AssistantMessageMetadata = {
  sessionId?: string;
  trace?: {
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
};

export type PxiMessage = UIMessage<AssistantMessageMetadata>;

export type BuiltInProvider =
  | 'ANTHROPIC'
  | 'AWS'
  | 'AZURE_OPENAI'
  | 'CEREBRAS'
  | 'DEEPSEEK'
  | 'FIREWORKS'
  | 'GOOGLE'
  | 'GROQ'
  | 'MOONSHOT'
  | 'OLLAMA'
  | 'OPENAI'
  | 'PERPLEXITY'
  | 'TOGETHER'
  | 'XAI';

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
  | { type: 'graphql'; mutationsEnabled: false }
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

export type PxiModelOption = {
  id: string;
  label: string;
  providerLabel: string;
  selection: ModelSelection;
  recommended: boolean;
};

export type PxiModelCatalog = {
  options: PxiModelOption[];
  defaultSelection: ModelSelection | null;
};

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
  | { type: 'subagents'; enabled: boolean };

export type PxiChatRequest = {
  id: string;
  messages: PxiMessage[];
  trigger: 'submit-message';
  ingestTraces: true;
  exportRemoteTraces: false;
  attachUserId: false;
  editPermission: 'manual';
  contexts: PxiContext[];
  model: ModelSelection;
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

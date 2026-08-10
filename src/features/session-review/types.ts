import type { Types } from '@arizeai/phoenix-client';

type Schemas = Types['V1']['components']['schemas'];

export type SessionData = Schemas['SessionData'];
export type SessionAnnotation = Schemas['SessionAnnotation'];
export type PhoenixSpan = Schemas['Span'];
export type CategoricalAnnotationConfig = Schemas['CategoricalAnnotationConfig'];
export type ContinuousAnnotationConfig = Schemas['ContinuousAnnotationConfig'];
export type FreeformAnnotationConfig = Schemas['FreeformAnnotationConfig'];

export type SessionAnnotationConfig =
  | CategoricalAnnotationConfig
  | ContinuousAnnotationConfig
  | FreeformAnnotationConfig;

export type SessionTurnIO = {
  mimeType?: string;
  value: string;
};

export type SessionTurn = {
  endTime: string;
  input?: SessionTurnIO;
  output?: SessionTurnIO;
  rootSpan?: PhoenixSpan;
  startTime: string;
  traceId: string;
};

export type SessionPage = {
  items: SessionData[];
  nextCursor: string | null;
};

export type ReviewStatus = 'not-configured' | 'unreviewed' | 'partial' | 'complete' | 'stale';

export type SessionReviewClassification = {
  completedConfigNames: string[];
  invalidConfigNames: string[];
  missingConfigNames: string[];
  requiredConfigNames: string[];
  status: ReviewStatus;
};

export type SessionAnnotationDraft =
  | { type: 'CATEGORICAL'; label: string; explanation?: string }
  | { type: 'CONTINUOUS'; score: number; explanation?: string }
  | { type: 'FREEFORM'; explanation: string };

export type SessionAnnotationWrite = {
  config: SessionAnnotationConfig;
  draft: SessionAnnotationDraft;
  identifier: string;
  sessionId: string;
};

export type SessionAnnotationsWrite = {
  annotations: SessionAnnotationWrite[];
};

export type SessionNoteWrite = {
  identifier: string;
  note: string;
  sessionId: string;
};


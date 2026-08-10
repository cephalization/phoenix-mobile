import type { Types } from '@arizeai/phoenix-client';

type Schemas = Types['V1']['components']['schemas'];

export type SessionData = Schemas['SessionData'];
export type DatasetSummary = Schemas['Dataset'];
export type SessionAnnotation = Schemas['SessionAnnotation'];
export type SpanNoteAnnotation = Schemas['SpanAnnotation'];
export type PhoenixSpan = Schemas['Span'];
export type CategoricalAnnotationConfig = Schemas['CategoricalAnnotationConfig'];
export type ContinuousAnnotationConfig = Schemas['ContinuousAnnotationConfig'];
export type FreeformAnnotationConfig = Schemas['FreeformAnnotationConfig'];

export type SessionAnnotationConfig =
  | CategoricalAnnotationConfig
  | ContinuousAnnotationConfig
  | FreeformAnnotationConfig;

export type AnnotationConfigOptimizationDirection = Schemas['OptimizationDirection'];
export type AnnotationConfigCreateData = Schemas['CreateAnnotationConfigData'];

export type AnnotationConfigValueDraft = {
  label: string;
  score?: number;
};

export type AnnotationConfigDraft =
  | {
      type: 'CATEGORICAL';
      optimizationDirection: AnnotationConfigOptimizationDirection;
      values: AnnotationConfigValueDraft[];
    }
  | {
      type: 'CONTINUOUS';
      optimizationDirection: AnnotationConfigOptimizationDirection;
      lowerBound?: number;
      upperBound?: number;
    }
  | { type: 'FREEFORM' };

export type AnnotationConfigWrite = {
  description?: string;
  draft: AnnotationConfigDraft;
  name: string;
};

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

export type SessionDatasetWrite = {
  action: 'create' | 'append';
  datasetName: string;
  description?: string;
  sessionId: string;
  turns: SessionTurn[];
};

export type SessionDatasetWriteResult = {
  datasetId: string;
  exampleCount: number;
};

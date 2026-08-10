import type {
  SessionAnnotation,
  SessionAnnotationConfig,
  SessionReviewClassification,
} from './types';

export function isValidHumanReviewAnnotation(
  annotation: SessionAnnotation,
  config: SessionAnnotationConfig
): boolean {
  if (annotation.annotator_kind !== 'HUMAN' || annotation.name === 'note') return false;
  if (annotation.name !== config.name || !annotation.result) return false;

  if (config.type === 'CATEGORICAL') {
    const label = annotation.result.label?.trim();
    return Boolean(label && config.values.some((value) => value.label === label));
  }

  if (config.type === 'CONTINUOUS') {
    const score = annotation.result.score;
    if (typeof score !== 'number' || !Number.isFinite(score)) return false;
    if (config.lower_bound != null && score < config.lower_bound) return false;
    if (config.upper_bound != null && score > config.upper_bound) return false;
    return true;
  }

  return Boolean(annotation.result.explanation?.trim());
}

export function latestOwnedAnnotation(
  annotations: readonly SessionAnnotation[],
  name: string,
  identifier: string,
  userId: string | null
): SessionAnnotation | undefined {
  return annotations
    .filter((annotation) => (
      annotation.name === name
      && annotation.identifier === identifier
      && annotation.user_id === userId
    ))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
}

export function classifySessionReview(
  requiredConfigNames: readonly string[],
  configs: readonly SessionAnnotationConfig[],
  annotations: readonly SessionAnnotation[]
): SessionReviewClassification {
  const required = [...new Set(requiredConfigNames.map((name) => name.trim()).filter(Boolean))];
  const configsByName = new Map(configs.map((config) => [config.name, config]));
  const humanAnnotations = annotations.filter(
    (annotation) => annotation.annotator_kind === 'HUMAN' && annotation.name !== 'note'
  );
  const completedConfigNames: string[] = [];
  const invalidConfigNames: string[] = [];
  const missingConfigNames: string[] = [];

  for (const name of required) {
    const config = configsByName.get(name);
    if (!config) {
      missingConfigNames.push(name);
      continue;
    }

    const matching = humanAnnotations.filter((annotation) => annotation.name === name);
    if (matching.some((annotation) => isValidHumanReviewAnnotation(annotation, config))) {
      completedConfigNames.push(name);
    } else if (matching.length > 0) {
      invalidConfigNames.push(name);
    }
  }

  let status: SessionReviewClassification['status'];
  if (required.length === 0) {
    status = 'not-configured';
  } else if (missingConfigNames.length > 0 || invalidConfigNames.length > 0) {
    status = 'stale';
  } else if (required.length > 0 && completedConfigNames.length === required.length) {
    status = 'complete';
  } else if (completedConfigNames.length > 0) {
    status = 'partial';
  } else {
    status = 'unreviewed';
  }

  return {
    completedConfigNames,
    invalidConfigNames,
    missingConfigNames,
    requiredConfigNames: required,
    status,
  };
}

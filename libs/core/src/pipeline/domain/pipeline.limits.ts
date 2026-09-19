import { PipelineException } from './pipeline.exception.js';
import type { PipelineLimits } from './pipeline.types.js';

export const MAX_FAILED_JOB_IDS = 100;

export const DEFAULT_PIPELINE_LIMITS: Readonly<PipelineLimits> = Object.freeze({
  discoveryQueries: 1,
  discoveryNews: 20,
  maxCandidates: 5,
  maxNewIssues: 3,
  issueSearchQueries: 2,
  relatedArticlesPerQuery: 10,
  maxBodyAttempts: 5,
  validBodiesTarget: 3,
  transientRetries: 1,
});

const MAX_LIMITS: PipelineLimits = {
  discoveryQueries: 1,
  discoveryNews: 20,
  maxCandidates: 5,
  maxNewIssues: 3,
  issueSearchQueries: 2,
  relatedArticlesPerQuery: 10,
  maxBodyAttempts: 5,
  validBodiesTarget: 3,
  transientRetries: 1,
};

export function normalizePipelineLimits(input: Partial<PipelineLimits> = {}): PipelineLimits {
  const result = { ...DEFAULT_PIPELINE_LIMITS };

  for (const key of Object.keys(result) as (keyof PipelineLimits)[]) {
    const value = input[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIMITS[key]) {
      throw new PipelineException(
        'PIPELINE_INVALID_INPUT',
        `${key} must be an integer from 1 to ${MAX_LIMITS[key]}`,
      );
    }
    result[key] = value;
  }
  if (result.validBodiesTarget < 2) {
    throw new PipelineException(
      'PIPELINE_INVALID_INPUT',
      'validBodiesTarget must be an integer from 2 to 3',
    );
  }
  if (result.maxBodyAttempts < result.validBodiesTarget) {
    throw new PipelineException(
      'PIPELINE_INVALID_INPUT',
      'maxBodyAttempts must be greater than or equal to validBodiesTarget',
    );
  }
  return result;
}

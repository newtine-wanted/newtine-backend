export const BATCH_JOB_NAMES = [
  'databaseCheck',
  'reportWorker',
  'pipelineWorker',
  'pipelineEmbeddingRepair',
] as const;

export type BatchJobName = (typeof BATCH_JOB_NAMES)[number];

export function resolveBatchJobName(value: string | undefined): BatchJobName | undefined {
  if (value === undefined) return undefined;
  return (BATCH_JOB_NAMES as readonly string[]).includes(value)
    ? (value as BatchJobName)
    : undefined;
}

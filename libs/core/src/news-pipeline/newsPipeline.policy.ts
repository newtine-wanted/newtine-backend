export const NEWS_RUN_STATUSES = ['RUNNING', 'FAILED', 'COMPLETED'] as const;
export type NewsRunStatus = (typeof NEWS_RUN_STATUSES)[number];
export function checkedRunStatus(value: unknown): NewsRunStatus {
  if (!NEWS_RUN_STATUSES.some((status) => status === value))
    throw new Error('INVALID_NEWS_RUN_STATUS');
  return value as NewsRunStatus;
}
export const NEWS_VALIDATION_MODES = ['AI', 'RULES_ONLY', 'TONE'] as const;
export type NewsValidationMode = (typeof NEWS_VALIDATION_MODES)[number];
export function checkedValidationMode(value: unknown): NewsValidationMode {
  if (!NEWS_VALIDATION_MODES.some((mode) => mode === value))
    throw new Error('INVALID_NEWS_VALIDATION_MODE');
  return value as NewsValidationMode;
}
export function validationModeFor(aiEnabled: unknown): NewsValidationMode {
  if (typeof aiEnabled !== 'boolean') throw new Error('INVALID_VALIDATION_CONFIG');
  return checkedValidationMode(aiEnabled ? 'TONE' : 'RULES_ONLY');
}
export function assertTermDefinition(value: { term: unknown; definition: unknown }): void {
  if (
    typeof value.term !== 'string' ||
    !value.term.trim() ||
    typeof value.definition !== 'string' ||
    !value.definition.trim()
  )
    throw new Error('INVALID_NEWS_TERM');
}
export function assertFollowUpTrack(value: {
  keywords: unknown;
  knownTitles: unknown;
  lastCheckedAt: string | Date;
  expiresAt: string | Date;
}): void {
  const isStrings = (v: unknown): boolean =>
    Array.isArray(v) && v.every((s) => typeof s === 'string');
  const last = new Date(value.lastCheckedAt).getTime(),
    expires = new Date(value.expiresAt).getTime();
  if (
    !isStrings(value.keywords) ||
    !isStrings(value.knownTitles) ||
    !Number.isFinite(last) ||
    !Number.isFinite(expires) ||
    expires <= last
  )
    throw new Error('INVALID_NEWS_FOLLOW_UP_TRACK');
}

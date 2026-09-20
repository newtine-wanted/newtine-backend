export const DEFAULT_OPENAI_TEXT_MODEL = 'gpt-5.4-mini-2026-03-17';

/** Standalone news pipeline uses the same text-model override as the existing worker. */
export function configuredNewsTextModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.PIPELINE_AI_MODEL?.trim() || DEFAULT_OPENAI_TEXT_MODEL;
}

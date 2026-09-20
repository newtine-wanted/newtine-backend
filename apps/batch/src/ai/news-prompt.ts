import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/** Standalone news CLIs run from the repository root, like their config and UX guide paths. */
export function newsPrompt(name: string, variables: Record<string, string | number> = {}): string {
  if (!/^[a-z-]+$/.test(name)) throw new Error('INVALID_NEWS_PROMPT_NAME');
  const template = readFileSync(resolve('prompts/news-pipeline', `${name}.md`), 'utf8').trim();
  if (!template) throw new Error('EMPTY_NEWS_PROMPT');
  return template.replace(/\{\{([a-zA-Z]+)\}\}/g, (_, key: string) => {
    if (!(key in variables)) throw new Error('MISSING_NEWS_PROMPT_VARIABLE');
    return String(variables[key]);
  });
}

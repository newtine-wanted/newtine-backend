import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { Injectable } from '@nestjs/common';
import { parse } from 'yaml';

import { DEFAULT_OPENAI_TEXT_MODEL } from '@newtine/batch/ai/ai-model.defaults.js';

export const PIPELINE_AI_CONFIG_ENV = 'PIPELINE_AI_CONFIG_PATH';
export const PIPELINE_AI_MODEL_ENV = 'PIPELINE_AI_MODEL';
export const DEFAULT_PIPELINE_AI_CONFIG_PATH = 'config/pipeline-ai.yml';

export const PIPELINE_AI_STAGES = ['candidate', 'content', 'validation', 'embedding'] as const;
export type PipelineAiStage = (typeof PIPELINE_AI_STAGES)[number];

export interface PipelinePromptConfig {
  readonly id: string;
  readonly version: string;
  readonly instruction: string;
  readonly hash: string;
}

export interface PipelineAiStageConfig {
  readonly model: string;
  readonly prompt?: PipelinePromptConfig;
  readonly schemaName?: string;
  readonly dimension?: number;
}

export interface PipelineAiUsageContext {
  readonly model: string;
  readonly promptVersion?: string;
  readonly promptHash?: string;
}

export interface PipelineAiConfigSnapshot {
  readonly version: number;
  readonly path: string;
  readonly stages: Readonly<Record<PipelineAiStage, PipelineAiStageConfig>>;
}

@Injectable()
export class PipelineAiConfiguration {
  readonly snapshot: PipelineAiConfigSnapshot;

  constructor(filePath?: string, env: NodeJS.ProcessEnv = process.env) {
    const configuredPath = filePath ?? env[PIPELINE_AI_CONFIG_ENV];
    const resolvedPath = isAbsolute(configuredPath ?? DEFAULT_PIPELINE_AI_CONFIG_PATH)
      ? (configuredPath ?? DEFAULT_PIPELINE_AI_CONFIG_PATH)
      : resolve(process.cwd(), configuredPath ?? DEFAULT_PIPELINE_AI_CONFIG_PATH);
    this.snapshot = loadPipelineAiConfig(
      resolvedPath,
      optionalNonEmptyString(env[PIPELINE_AI_MODEL_ENV]),
    );
  }

  stage(stage: PipelineAiStage): PipelineAiStageConfig {
    return this.snapshot.stages[stage];
  }

  usageContext(stage: PipelineAiStage): PipelineAiUsageContext {
    const configuration = this.stage(stage);
    return {
      model: configuration.model,
      ...(configuration.prompt === undefined
        ? {}
        : {
            promptVersion: `${configuration.prompt.id}@${configuration.prompt.version}`,
            promptHash: configuration.prompt.hash,
          }),
    };
  }
}

export function loadPipelineAiConfig(
  filePath: string,
  modelOverride?: string,
): PipelineAiConfigSnapshot {
  let source: string;
  try {
    source = readFileSync(filePath, 'utf8');
  } catch (error: unknown) {
    throw new Error(`Failed to read pipeline AI config: ${filePath}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = parse(source);
  } catch (error: unknown) {
    throw new Error(`Failed to parse pipeline AI config: ${filePath}`, { cause: error });
  }

  const record = asRecord(parsed, 'root');
  const version = positiveInteger(record.version, 'version');
  const rawStages = asRecord(record.stages, 'stages');
  const stages = {
    candidate: parseLlmStage(rawStages.candidate, 'candidate', modelOverride),
    content: parseLlmStage(rawStages.content, 'content', modelOverride),
    validation: parseLlmStage(rawStages.validation, 'validation', modelOverride),
    embedding: parseEmbeddingStage(rawStages.embedding),
  } satisfies Record<PipelineAiStage, PipelineAiStageConfig>;

  return deepFreeze({ version, path: filePath, stages });
}

function parseLlmStage(
  value: unknown,
  stage: Exclude<PipelineAiStage, 'embedding'>,
  modelOverride?: string,
): PipelineAiStageConfig {
  const record = asRecord(value, `stages.${stage}`);
  const model =
    modelOverride ??
    optionalConfigString(record.model, `stages.${stage}.model`) ??
    DEFAULT_OPENAI_TEXT_MODEL;
  const prompt = asRecord(record.prompt, `stages.${stage}.prompt`);
  const schemaName = nonEmptyString(record.schemaName, `stages.${stage}.schemaName`);
  const promptConfig = parsePrompt(prompt, `stages.${stage}.prompt`);
  return { model, schemaName, prompt: promptConfig };
}

function parseEmbeddingStage(value: unknown): PipelineAiStageConfig {
  const record = asRecord(value, 'stages.embedding');
  const dimension = positiveInteger(record.dimension, 'stages.embedding.dimension');
  if (dimension !== 1_536) {
    throw new Error(
      'Pipeline AI config field stages.embedding.dimension must be 1536 for the current vector schema',
    );
  }
  return { model: nonEmptyString(record.model, 'stages.embedding.model'), dimension };
}

function parsePrompt(value: Record<string, unknown>, path: string): PipelinePromptConfig {
  const id = nonEmptyString(value.id, `${path}.id`);
  const version = nonEmptyString(value.version, `${path}.version`);
  const instruction = nonEmptyString(value.instruction, `${path}.instruction`);
  const hash = createHash('sha256')
    .update(canonicalJson({ id, version, instruction }))
    .digest('hex');
  return { id, version, instruction, hash };
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Pipeline AI config field must be an object: ${path}`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Pipeline AI config field must be a non-empty string: ${path}`);
  }
  return value.trim();
}

function optionalConfigString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`Pipeline AI config field must be a string: ${path}`);
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function optionalNonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Pipeline AI config field must be a positive integer: ${path}`);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

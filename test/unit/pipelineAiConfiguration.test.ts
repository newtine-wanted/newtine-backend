import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { DEFAULT_OPENAI_TEXT_MODEL } from '@newtine/batch/ai/ai-model.defaults.js';
import {
  DEFAULT_PIPELINE_AI_CONFIG_PATH,
  PipelineAiConfiguration,
  loadPipelineAiConfig,
} from '@newtine/batch/pipeline/pipeline.ai.config.js';

test('pipeline AI configuration snapshots stage models and immutable prompt hashes', () => {
  const snapshot = loadPipelineAiConfig(join(process.cwd(), DEFAULT_PIPELINE_AI_CONFIG_PATH));

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.stages.candidate.model, 'gpt-5.4-mini-2026-03-17');
  assert.equal(snapshot.stages.embedding.dimension, 1_536);
  assert.match(snapshot.stages.content.prompt!.hash, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.stages.content.prompt), true);
});

test('pipeline AI model env overrides every text stage while keeping embedding separate', () => {
  const configuration = new PipelineAiConfiguration(undefined, {
    ...process.env,
    PIPELINE_AI_MODEL: 'env-pipeline-model',
  });

  assert.equal(configuration.stage('candidate').model, 'env-pipeline-model');
  assert.equal(configuration.stage('content').model, 'env-pipeline-model');
  assert.equal(configuration.stage('validation').model, 'env-pipeline-model');
  assert.equal(configuration.stage('embedding').model, 'text-embedding-3-small');
});

test('pipeline AI text stages fall back to the shared model when YAML omits their models', () => {
  const directory = mkdtempSync(join(tmpdir(), 'newtine-pipeline-ai-'));
  const path = join(directory, 'pipeline-ai.yml');
  try {
    const source = readFileSync(join(process.cwd(), DEFAULT_PIPELINE_AI_CONFIG_PATH), 'utf8');
    writeFileSync(
      path,
      source
        .split('\n')
        .filter((line) => line !== '    model: gpt-5.4-mini-2026-03-17')
        .join('\n'),
    );
    const snapshot = loadPipelineAiConfig(path);

    assert.equal(snapshot.stages.candidate.model, DEFAULT_OPENAI_TEXT_MODEL);
    assert.equal(snapshot.stages.content.model, DEFAULT_OPENAI_TEXT_MODEL);
    assert.equal(snapshot.stages.validation.model, DEFAULT_OPENAI_TEXT_MODEL);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('pipeline AI configuration rejects an embedding dimension outside the current vector schema', () => {
  const directory = mkdtempSync(join(tmpdir(), 'newtine-pipeline-ai-'));
  const path = join(directory, 'pipeline-ai.yml');
  try {
    const source = readFileSync(join(process.cwd(), DEFAULT_PIPELINE_AI_CONFIG_PATH), 'utf8');
    writeFileSync(path, source.replace('dimension: 1536', 'dimension: 768'));
    assert.throws(() => new PipelineAiConfiguration(path), /dimension must be 1536/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import {
  ARTICLE_BODY_PROVIDER,
  CANDIDATE_CLASSIFIER,
  CONTENT_GENERATOR,
  CoreModule,
  createLoggerOptions,
  EMBEDDING_PROVIDER,
  NEWS_SEARCH_PROVIDER,
  SEMANTIC_VALIDATOR,
} from '@newtine/core';
import { BATCH_JOB } from '@newtine/batch/runner/batch.job.js';
import { NaverArticleBodyProvider, NaverNewsProvider } from './naverNews.provider.js';
import {
  OpenAiCandidateClassifier,
  OpenAiContentGenerator,
  OpenAiEmbeddingProvider,
  OpenAiResponsesClient,
  OpenAiSemanticValidator,
} from './openAi.provider.js';
import { PipelineAiConfiguration } from './pipeline.ai.config.js';
import { PipelineBatchJob } from './pipeline.batch.job.js';
import { PipelineEmbeddingRepairBatchJob } from './pipeline.embeddingRepair.batch.job.js';
import { PipelineEmbeddingRepairJob } from './pipeline.embeddingRepair.job.js';
import { PipelineWorker } from './pipeline.worker.js';

export type PipelineBatchJobName = 'pipelineWorker' | 'pipelineEmbeddingRepair';

@Module({})
export class PipelineBatchModule {
  static forJob(jobName: PipelineBatchJobName): DynamicModule {
    const selectedJob =
      jobName === 'pipelineWorker' ? PipelineBatchJob : PipelineEmbeddingRepairBatchJob;

    return {
      module: PipelineBatchModule,
      imports: [LoggerModule.forRoot(createLoggerOptions('batch')), CoreModule],
      providers: [
        {
          provide: PipelineAiConfiguration,
          useFactory: () => new PipelineAiConfiguration(),
        },
        NaverNewsProvider,
        NaverArticleBodyProvider,
        OpenAiResponsesClient,
        OpenAiCandidateClassifier,
        OpenAiContentGenerator,
        OpenAiSemanticValidator,
        OpenAiEmbeddingProvider,
        { provide: NEWS_SEARCH_PROVIDER, useExisting: NaverNewsProvider },
        { provide: ARTICLE_BODY_PROVIDER, useExisting: NaverArticleBodyProvider },
        { provide: CANDIDATE_CLASSIFIER, useExisting: OpenAiCandidateClassifier },
        { provide: CONTENT_GENERATOR, useExisting: OpenAiContentGenerator },
        { provide: SEMANTIC_VALIDATOR, useExisting: OpenAiSemanticValidator },
        { provide: EMBEDDING_PROVIDER, useExisting: OpenAiEmbeddingProvider },
        ...(jobName === 'pipelineWorker' ? [PipelineWorker, PipelineBatchJob] : []),
        ...(jobName === 'pipelineEmbeddingRepair'
          ? [PipelineEmbeddingRepairJob, PipelineEmbeddingRepairBatchJob]
          : []),
        { provide: BATCH_JOB, useExisting: selectedJob },
      ],
      exports: [BATCH_JOB, LoggerModule],
    };
  }
}

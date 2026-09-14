import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { CoreModule, createLoggerOptions } from '@newtine/core';

import { DatabaseCheckJob } from '@newtine/batch/job/databaseCheck/databaseCheck.job.js';
import { BatchRunner } from '@newtine/batch/runner/batch.runner.js';
import { PipelineBatchJob } from '@newtine/batch/pipeline/pipeline.batch.job.js';
import { PipelineAiConfiguration } from '@newtine/batch/pipeline/pipeline.ai.config.js';
import { PipelineWorker } from '@newtine/batch/pipeline/pipeline.worker.js';
import { PipelineEmbeddingRepairJob } from '@newtine/batch/pipeline/pipeline.embeddingRepair.job.js';
import {
  NaverArticleBodyProvider,
  NaverNewsProvider,
} from '@newtine/batch/pipeline/naverNews.provider.js';
import {
  OpenAiCandidateClassifier,
  OpenAiContentGenerator,
  OpenAiEmbeddingProvider,
  OpenAiResponsesClient,
  OpenAiSemanticValidator,
} from '@newtine/batch/pipeline/openAi.provider.js';
import {
  ARTICLE_BODY_PROVIDER,
  CANDIDATE_CLASSIFIER,
  CONTENT_GENERATOR,
  EMBEDDING_PROVIDER,
  NEWS_SEARCH_PROVIDER,
  SEMANTIC_VALIDATOR,
} from '@newtine/core';

@Module({
  imports: [LoggerModule.forRoot(createLoggerOptions('batch')), CoreModule],
  providers: [
    DatabaseCheckJob,
    BatchRunner,
    PipelineBatchJob,
    {
      provide: PipelineAiConfiguration,
      useFactory: () => new PipelineAiConfiguration(),
    },
    PipelineWorker,
    PipelineEmbeddingRepairJob,
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
  ],
})
export class BatchModule {}

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger as NestPinoLogger, PinoLogger } from 'nestjs-pino';

import { exceptionDiagnostic } from '@newtine/core';
import { BatchModule } from '@newtine/batch/batch.module.js';
import { BatchRunner } from '@newtine/batch/runner/batch.runner.js';
import { resolveBatchJobName } from '@newtine/batch/runner/batch.role.js';

async function bootstrap(): Promise<void> {
  const jobName = resolveBatchJobName(process.argv[2]);
  if (jobName === undefined) {
    process.stderr.write(
      JSON.stringify({ event: 'batch.invalid_job', jobName: process.argv[2] ?? null }) + '\n',
    );
    process.exitCode = 1;
    return;
  }

  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
  let pinoLogger: PinoLogger | undefined;
  let exitCode = 1;
  const shutdownController = new AbortController();
  const requestShutdown = (signal: NodeJS.Signals): void => {
    if (shutdownController.signal.aborted) {
      exitCode = 1;
      return;
    }
    shutdownController.abort();
    const message = { event: 'batch.shutdown.requested', signal };
    if (pinoLogger) {
      pinoLogger.warn(message, 'Batch graceful shutdown requested');
    } else {
      process.stderr.write(`${JSON.stringify(message)}\n`);
    }
  };
  const onSigterm = (): void => requestShutdown('SIGTERM');
  const onSigint = (): void => requestShutdown('SIGINT');
  process.once('SIGTERM', onSigterm);
  process.once('SIGINT', onSigint);

  try {
    app = await NestFactory.createApplicationContext(BatchModule.forRole(jobName), {
      bufferLogs: true,
    });
    app.useLogger(app.get(NestPinoLogger));
    pinoLogger = await app.resolve(PinoLogger);
    pinoLogger?.setContext('BatchBootstrap');
    exitCode = await app.get(BatchRunner).run(jobName, shutdownController.signal);
  } catch (exception: unknown) {
    const diagnostic = exceptionDiagnostic(exception);
    if (pinoLogger) {
      pinoLogger.error({ event: 'batch.bootstrap.failed', diagnostic }, 'Batch bootstrap failed');
    } else {
      process.stderr.write(`${JSON.stringify({ event: 'batch.bootstrap.failed', diagnostic })}\n`);
    }
  } finally {
    process.removeListener('SIGTERM', onSigterm);
    process.removeListener('SIGINT', onSigint);
    if (app) {
      try {
        await app.close();
      } catch (exception: unknown) {
        const diagnostic = exceptionDiagnostic(exception);
        if (pinoLogger) {
          pinoLogger.error({ event: 'batch.shutdown.failed', diagnostic }, 'Batch shutdown failed');
        } else {
          process.stderr.write(
            `${JSON.stringify({ event: 'batch.shutdown.failed', diagnostic })}\n`,
          );
        }
        exitCode = 1;
      }
      pinoLogger?.logger.flush();
    }
  }

  process.exitCode = exitCode;
}

void bootstrap();

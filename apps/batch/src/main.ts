import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger as NestPinoLogger, PinoLogger } from 'nestjs-pino';

import { exceptionDiagnostic } from '@newtine/core';
import { BatchModule } from '@newtine/batch/batch.module.js';
import { BatchRunner } from '@newtine/batch/runner/batch.runner.js';

async function bootstrap(): Promise<void> {
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
  let pinoLogger: PinoLogger | undefined;
  let exitCode = 1;

  try {
    app = await NestFactory.createApplicationContext(BatchModule, {
      bufferLogs: true,
    });
    app.useLogger(app.get(NestPinoLogger));
    pinoLogger = await app.resolve(PinoLogger);
    pinoLogger?.setContext('BatchBootstrap');
    exitCode = await app.get(BatchRunner).run(process.argv[2]);
  } catch (exception: unknown) {
    const diagnostic = exceptionDiagnostic(exception);
    if (pinoLogger) {
      pinoLogger.error({ event: 'batch.bootstrap.failed', diagnostic }, 'Batch bootstrap failed');
    } else {
      process.stderr.write(`${JSON.stringify({ event: 'batch.bootstrap.failed', diagnostic })}\n`);
    }
  } finally {
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

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as NestPinoLogger, PinoLogger } from 'nestjs-pino';

import { exceptionDiagnostic, resolveHttpSlowThreshold } from '@newtine/core';
import { ApiModule } from '@newtine/api/api.module.js';
import { bodyParserExceptionMiddleware } from '@newtine/api/common/middleware/bodyParser.middleware.js';
import { HttpRequestContextMiddleware } from '@newtine/api/common/middleware/httpRequestContext.middleware.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule, {
    bodyParser: false,
    bufferLogs: true,
  });
  let pinoLogger: PinoLogger | undefined;

  try {
    app.useLogger(app.get(NestPinoLogger));
    pinoLogger = await app.resolve(PinoLogger);
    pinoLogger?.setContext('ApiBootstrap');
    const httpRequestContextMiddleware = new HttpRequestContextMiddleware(
      pinoLogger,
      resolveHttpSlowThreshold(),
    );
    app.use(httpRequestContextMiddleware.use.bind(httpRequestContextMiddleware));
    app.useBodyParser('json');
    app.useBodyParser('urlencoded', { extended: true });
    app.use(bodyParserExceptionMiddleware);
    app.enableShutdownHooks();

    const port = Number(process.env.API_PORT ?? 3000);
    await app.listen(port, process.env.API_HOST ?? '127.0.0.1');

    if (process.env.API_SMOKE_READY === '1' && typeof process.send === 'function') {
      const address = app.getHttpServer().address();
      const actualPort =
        typeof address === 'object' && address !== null && 'port' in address ? address.port : port;
      process.send({ type: 'ready', port: actualPort });
    }
  } catch (exception: unknown) {
    const diagnostic = exceptionDiagnostic(exception);
    if (pinoLogger) {
      pinoLogger.setContext('ApiBootstrap');
      pinoLogger.error({ event: 'api.bootstrap.failed', diagnostic }, 'API bootstrap failed');
    } else {
      process.stderr.write(`${JSON.stringify({ event: 'api.bootstrap.failed', diagnostic })}\n`);
    }
    process.exitCode = 1;
    await app.close().catch((closeException: unknown) => {
      const closeDiagnostic = exceptionDiagnostic(closeException);
      if (pinoLogger) {
        pinoLogger.setContext('ApiBootstrap');
        pinoLogger.error(
          { event: 'api.shutdown.failed', diagnostic: closeDiagnostic },
          'API shutdown failed',
        );
      } else {
        process.stderr.write(
          `${JSON.stringify({ event: 'api.shutdown.failed', diagnostic: closeDiagnostic })}\n`,
        );
      }
    });
    pinoLogger?.logger.flush();
  }
}

void bootstrap().catch((exception: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ event: 'api.bootstrap.failed', diagnostic: exceptionDiagnostic(exception) })}\n`,
  );
  process.exitCode = 1;
});

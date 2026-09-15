import type { INestiaConfig } from '@nestia/sdk';

const config: INestiaConfig = {
  input: {
    include: ['apps/api/src/**/*.ts'],
    exclude: ['apps/api/src/main.ts'],
  },
  output: 'generated/api',
  e2e: 'generated/e2e',
  swagger: {
    output: 'generated/openapi.json',
    openapi: '3.1',
    beautify: 2,
    additional: true,
    servers: [{ url: '/', description: 'Current API origin' }],
    info: {
      title: 'Newtine API',
      version: '0.1.0',
    },
    security: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      guestFeedCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'newtine_feed_guest',
      },
    },
  },
  primitive: false,
};

export default config;

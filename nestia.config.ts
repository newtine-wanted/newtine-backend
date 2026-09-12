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
  },
  primitive: false,
};

export default config;

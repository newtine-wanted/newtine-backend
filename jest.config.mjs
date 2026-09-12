export default {
  displayName: 'newtine-backend',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts', '**/*.test.mjs'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': '<rootDir>/jest.transformer.mjs',
  },
  moduleNameMapper: {
    '^@newtine/api/(.*)\\.js$': '<rootDir>/apps/api/src/$1.ts',
    '^@newtine/batch/(.*)\\.js$': '<rootDir>/apps/batch/src/$1.ts',
    '^@newtine/core/(.*)\\.js$': '<rootDir>/libs/core/src/$1.ts',
    '^@newtine/core$': '<rootDir>/libs/core/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverage: false,
};

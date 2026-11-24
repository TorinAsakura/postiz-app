const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('../../tsconfig.base.json');

module.exports = {
  rootDir: '../..',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/apps/backend/src/**/*.test.ts',
    '<rootDir>/libraries/nestjs-libraries/src/**/*.test.ts',
  ],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: '<rootDir>/apps/backend/tsconfig.build.json' },
    ],
  },
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, {
    prefix: '<rootDir>/',
  }),
};

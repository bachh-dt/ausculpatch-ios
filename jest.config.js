/** Tests cover the protocol, download and signal-processing code, which has no React Native dependency. */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs', target: 'es2020', esModuleInterop: true, strict: true, isolatedModules: true, rootDir: '.', types: ['jest', 'node'] } }],
  },
};

import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      vscode: resolve(__dirname, 'test/support/vscode.ts')
    }
  },
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts']
  }
});

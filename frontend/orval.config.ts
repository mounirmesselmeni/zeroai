import { defineConfig } from 'orval';

export default defineConfig({
  zeroai: {
    input: { target: './src/api/openapi.json' },
    output: {
      mode: 'tags-split',
      target: './src/api/generated',
      schemas: './src/api/generated/model',
      client: 'react-query',
      httpClient: 'axios',
      clean: true,
      mock: {
        indexMockFiles: true,
        generators: [{ type: 'msw', delay: false }],
      },
      override: {
        mutator: { path: './src/api/axios-instance.ts', name: 'customInstance' },
      },
    },
  },
});

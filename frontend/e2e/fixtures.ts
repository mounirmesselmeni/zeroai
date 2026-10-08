import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      window.__ZEROAI_E2E_FIXTURES__ = {
        sources: [],
        settings: {
          provider: 'ollama',
          model: 'qwen3:latest',
          base_url: 'http://localhost:11434/v1',
          thinking: true,
          thinking_effort: 'high',
          api_key_set: false,
        },
        ...JSON.parse(window.name || '{}'),
      };
      window.name = '';
    });
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright names this fixture callback `use`.
    await use(page);
  },
});

export { expect };

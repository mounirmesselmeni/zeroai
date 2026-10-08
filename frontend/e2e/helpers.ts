import type { Page } from '@playwright/test';
import type { E2EFixtures } from '../src/test/e2e-msw';

export const sse = (events: [string, unknown][]) =>
  events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');

export const NEWS = {
  ticker: 'AAPL',
  errors: [],
  items: [
    {
      title: 'Apple unveils new chip',
      link: 'https://example.com/apple-chip',
      source: 'Yahoo Finance',
      published: '2026-10-06T10:00:00Z',
      snippet: '',
    },
  ],
};

export const SUMMARY = {
  headline: 'Apple unveiled a new chip.',
  sentiment: 'bullish',
  key_points: ['New chip announced', 'Analysts upbeat'],
  risks: ['Supply constraints'],
  outlook: 'Watch the next earnings call.',
};

export const USAGE = {
  provider: 'ollama',
  model: 'qwen3:latest',
  input_tokens: 1000,
  output_tokens: 234,
  total_tokens: 1234,
  requests: 1,
  duration_ms: 4249,
};

export function configureApi(page: Page, fixtures: E2EFixtures) {
  return page.evaluate((updates) => {
    const current = JSON.parse(window.name || '{}') as E2EFixtures;
    window.name = JSON.stringify({ ...current, ...updates });
  }, fixtures);
}

export async function getApiState(page: Page) {
  return page.evaluate(() => window.__ZEROAI_E2E_STATE__!);
}

export async function stubStream(page: Page, body: string, delayMs = 0) {
  await configureApi(page, { stream: body, streamDelayMs: delayMs });
}

export interface Source {
  id: number;
  name: string;
  url_template: string;
  enabled: boolean;
}

/** Set the initial API state for the generated sources handlers. */
export async function stubSources(page: Page, initial: Source[]) {
  await configureApi(page, { sources: initial });
}

export interface LlmSettings {
  provider: 'ollama' | 'openai';
  model: string;
  base_url: string | null;
  thinking: boolean;
  thinking_effort: 'low' | 'medium' | 'high';
  api_key_set: boolean;
}

/** Set the initial settings and usage responses for the generated handlers. */
export async function stubSettings(page: Page, initial: LlmSettings, delayMs = 0) {
  await configureApi(page, { settings: initial, settingsDelayMs: delayMs });
}

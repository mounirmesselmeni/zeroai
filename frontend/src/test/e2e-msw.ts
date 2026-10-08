import { setupWorker } from 'msw/browser';
import type { ModelUsage, NewsSourceRead, LLMConfigRead, UsageRun } from '../api/generated/model';
import { getMetaMock } from '../api/generated/meta/meta.msw';
import {
  getGetLlmSettingsMockHandler,
  getUpdateLlmSettingsMockHandler,
} from '../api/generated/settings/settings.msw';
import {
  getCheckSourceMockHandler,
  getCreateSourceMockHandler,
  getDeleteSourceMockHandler,
  getListSourcesMockHandler,
  getUpdateSourceMockHandler,
} from '../api/generated/sources/sources.msw';
import { getStreamSummaryMockHandler } from '../api/generated/stocks/stocks.msw';
import {
  getGetRecentRunsMockHandler,
  getGetUsageByModelMockHandler,
} from '../api/generated/usage/usage.msw';

export interface E2EFixtures {
  sources?: NewsSourceRead[];
  settings?: LLMConfigRead;
  usage?: ModelUsage[];
  runs?: UsageRun[];
  stream?: string;
  streamDelayMs?: number;
  settingsDelayMs?: number;
}

interface E2EState {
  sources: NewsSourceRead[];
  settings: LLMConfigRead;
  lastSettingsPut: Record<string, unknown> | null;
}

declare global {
  interface Window {
    __ZEROAI_E2E_FIXTURES__?: E2EFixtures;
    __ZEROAI_E2E_STATE__?: E2EState;
  }
}

const DEFAULT_SETTINGS: LLMConfigRead = {
  provider: 'ollama',
  model: 'qwen3:latest',
  base_url: 'http://localhost:11434/v1',
  thinking: true,
  thinking_effort: 'high',
  api_key_set: false,
};

const DEFAULT_USAGE: ModelUsage[] = [
  {
    provider: 'ollama',
    model: 'qwen3:latest',
    runs: 2,
    requests: 2,
    input_tokens: 2000,
    output_tokens: 468,
    total_tokens: 2468,
    avg_duration_ms: 4000,
    last_used: '2026-10-07T10:00:00Z',
  },
];

const DEFAULT_STREAM = [
  'event: news\ndata: {"ticker":"AAPL","errors":[],"items":[]}\n\n',
  'event: done\ndata: {"summary":{"headline":"Apple briefing complete.","sentiment":"bullish","key_points":["Demand is strong"],"risks":[],"outlook":"Watch earnings."},"usage":{"provider":"ollama","model":"qwen3:latest","input_tokens":1000,"output_tokens":234,"total_tokens":1234,"requests":1,"duration_ms":4249}}\n\n',
].join('');

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startE2EMocks() {
  const fixtures = window.__ZEROAI_E2E_FIXTURES__ ?? {};
  const state: E2EState = {
    sources: structuredClone(fixtures.sources ?? []),
    settings: { ...(fixtures.settings ?? DEFAULT_SETTINGS) },
    lastSettingsPut: null,
  };
  window.__ZEROAI_E2E_STATE__ = state;
  let nextSourceId = 100;

  const worker = setupWorker(
    ...getMetaMock(),
    getListSourcesMockHandler(() => state.sources),
    getCreateSourceMockHandler(async ({ request }) => {
      const body = (await request.json()) as Omit<NewsSourceRead, 'id' | 'enabled'> & {
        enabled?: boolean;
      };
      const created = { id: nextSourceId++, enabled: true, ...body };
      state.sources.push(created);
      return created;
    }),
    getCheckSourceMockHandler(async ({ request }) => {
      const { url_template } = (await request.json()) as { url_template: string };
      return url_template.includes('edition.cnn.com')
        ? {
            ok: false,
            kind: null,
            item_count: 0,
            sample: [],
            error: 'this is a web page, not an RSS/Atom feed',
          }
        : { ok: true, kind: 'rss', item_count: 15, sample: ['Apple unveils chip'], error: null };
    }),
    getUpdateSourceMockHandler(async ({ params, request }) => {
      const id = Number(params.sourceId);
      const source = state.sources.find((item) => item.id === id);
      if (!source) return { id, name: '', url_template: '', enabled: false };
      Object.assign(source, await request.json());
      return source;
    }),
    getDeleteSourceMockHandler(({ params }) => {
      state.sources = state.sources.filter((item) => item.id !== Number(params.sourceId));
    }),
    getGetLlmSettingsMockHandler(async () => {
      if (fixtures.settingsDelayMs) await pause(fixtures.settingsDelayMs);
      return state.settings;
    }),
    getUpdateLlmSettingsMockHandler(async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.lastSettingsPut = body;
      state.settings = {
        ...state.settings,
        provider: body.provider as LLMConfigRead['provider'],
        model: body.model as string,
        base_url: (body.base_url as string | null) ?? null,
        thinking: (body.thinking as boolean | undefined) ?? state.settings.thinking,
        thinking_effort:
          (body.thinking_effort as LLMConfigRead['thinking_effort'] | undefined) ??
          state.settings.thinking_effort,
        api_key_set: body.api_key === undefined ? state.settings.api_key_set : body.api_key !== '',
      };
      return state.settings;
    }),
    getGetUsageByModelMockHandler(() => fixtures.usage ?? DEFAULT_USAGE),
    getGetRecentRunsMockHandler(() => fixtures.runs ?? []),
    getStreamSummaryMockHandler(async () => {
      if (fixtures.streamDelayMs) await pause(fixtures.streamDelayMs);
      return fixtures.stream ?? DEFAULT_STREAM;
    }),
  );

  await worker.start({
    onUnhandledRequest(request, print) {
      if (new URL(request.url).pathname.startsWith('/api/')) print.error();
    },
  });
}

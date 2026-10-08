import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FakeEventSource } from '../test/fakes';
import { useSummaryStream } from './useSummaryStream';

beforeEach(() => {
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const usage = {
  provider: 'ollama',
  model: 'qwen3:latest',
  input_tokens: 1000,
  output_tokens: 234,
  total_tokens: 1234,
  requests: 1,
  duration_ms: 4249,
};

const summary = {
  headline: 'h',
  sentiment: 'bullish',
  key_points: ['a'],
  risks: [],
  outlook: 'o',
} as const;

it('walks through the whole event sequence and closes the stream', () => {
  const { result } = renderHook(() => useSummaryStream());
  act(() => result.current.start('BRK.B'));
  const es = FakeEventSource.last;
  expect(es.url).toBe('/api/v1/stocks/BRK.B/summary/stream');
  expect(result.current.state.phase).toBe('fetching');

  act(() => es.emit('status', { message: 'Fetching news for BRK.B' }));
  act(() => es.emit('news', { ticker: 'BRK.B', items: [], errors: [] }));
  act(() => es.emit('status', { message: 'Summarising' }));
  expect(result.current.state.phase).toBe('summarising');
  act(() => es.emit('summary', { headline: 'par' }));
  expect(result.current.state.summary).toEqual({ headline: 'par' });
  act(() => es.emit('done', { summary, usage }));
  expect(result.current.state).toMatchObject({ phase: 'done', summary, usage, error: null });
  expect(es.closed).toBe(true);
});

it('uses the configured API base URL for the stream', () => {
  vi.stubEnv('VITE_API_URL', 'https://api.example.test/root/');
  const { result } = renderHook(() => useSummaryStream());
  act(() => result.current.start('AAPL'));
  expect(FakeEventSource.last.url).toBe(
    'https://api.example.test/root/api/v1/stocks/AAPL/summary/stream',
  );
});

it('reports server error events', () => {
  const { result } = renderHook(() => useSummaryStream());
  act(() => result.current.start('X'));
  act(() => FakeEventSource.last.emit('error', { message: 'No recent news found for X.' }));
  expect(result.current.state).toMatchObject({
    phase: 'error',
    error: 'No recent news found for X.',
  });
  expect(FakeEventSource.last.closed).toBe(true);
});

it('treats a dropped connection as an error, but not after completion', () => {
  const { result } = renderHook(() => useSummaryStream());
  act(() => result.current.start('X'));
  act(() => FakeEventSource.last.connectionError());
  expect(result.current.state.error).toBe('Connection to the server was lost.');

  act(() => result.current.start('Y'));
  const es = FakeEventSource.last;
  act(() => es.emit('done', { summary, usage }));
  act(() => es.onerror?.());
  expect(result.current.state.phase).toBe('done');
});

it('ignores errors from a superseded stream and closes on unmount', () => {
  const { result, unmount } = renderHook(() => useSummaryStream());
  act(() => result.current.start('A'));
  const first = FakeEventSource.last;
  act(() => result.current.start('B'));
  expect(first.closed).toBe(true);
  act(() => first.onerror?.());
  act(() => first.emit('done', { summary, usage }));
  expect(result.current.state.phase).toBe('fetching');
  expect(FakeEventSource.last.closed).toBe(false);
  unmount();
  expect(FakeEventSource.last.closed).toBe(true);
});

it('reports malformed event JSON without leaving the stream running', () => {
  const { result } = renderHook(() => useSummaryStream());
  act(() => result.current.start('X'));
  act(() => FakeEventSource.last.emitRaw('summary', '{broken'));
  expect(result.current.state).toMatchObject({
    phase: 'error',
    error: 'The server sent an invalid response.',
  });
  expect(FakeEventSource.last.closed).toBe(true);
});

it('stop() closes the stream', () => {
  const { result } = renderHook(() => useSummaryStream());
  act(() => result.current.start('A'));
  act(() => result.current.stop());
  expect(FakeEventSource.last.closed).toBe(true);
});

it('accumulates thinking deltas and records the start time', () => {
  const { result } = renderHook(() => useSummaryStream());
  const before = Date.now();
  act(() => result.current.start('X'));
  expect(result.current.state.startedAt).toBeGreaterThanOrEqual(before);
  const es = FakeEventSource.last;
  act(() => es.emit('thinking', { delta: 'Let me ' }));
  act(() => es.emit('thinking', { delta: 'think.' }));
  expect(result.current.state.thinking).toBe('Let me think.');
  act(() => result.current.start('Y'));
  expect(result.current.state.thinking).toBe('');
});

it('cancel() aborts a running lookup, keeps what arrived, and ignores a finished one', () => {
  const { result } = renderHook(() => useSummaryStream());
  act(() => result.current.start('X'));
  const es = FakeEventSource.last;
  act(() => es.emit('thinking', { delta: 'partial' }));
  act(() => result.current.cancel());
  expect(es.closed).toBe(true);
  expect(result.current.state).toMatchObject({ phase: 'stopped', thinking: 'partial' });
  // a late network error after Stop must not turn into an error banner
  act(() => es.onerror?.());
  expect(result.current.state.phase).toBe('stopped');

  act(() => result.current.start('Y'));
  act(() => FakeEventSource.last.emit('done', { summary, usage }));
  act(() => result.current.cancel());
  expect(result.current.state.phase).toBe('done');
});

it('a dropped connection throws nothing: the browser error event has no data to parse', () => {
  const { result } = renderHook(() => useSummaryStream());
  act(() => result.current.start('X'));
  const es = FakeEventSource.last;
  // The real browser dispatches this to the same listeners that handle our server's "error"
  // events. Parsing its missing data used to throw SyntaxError in the page.
  expect(() => act(() => es.connectionError())).not.toThrow();
  expect(result.current.state).toMatchObject({
    phase: 'error',
    error: 'Connection to the server was lost.',
  });
  expect(es.closed).toBe(true);
});

it('still reads a server-sent error event that has data', () => {
  const { result } = renderHook(() => useSummaryStream());
  act(() => result.current.start('X'));
  act(() => FakeEventSource.last.emit('error', { message: 'No recent news found for X.' }));
  expect(result.current.state.error).toBe('No recent news found for X.');
});

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NewsResponse, StockSummary } from '../api/generated/model';
import { apiUrl } from '../api/axios-instance';

/** Mirrors the backend's `RunStats` (sent in the `done` event, not part of the OpenAPI paths). */
export interface RunStats {
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  requests: number;
  duration_ms: number;
}

export type StreamPhase = 'idle' | 'fetching' | 'summarising' | 'done' | 'error' | 'stopped';

export interface StreamState {
  phase: StreamPhase;
  status: string;
  news: NewsResponse | null;
  summary: Partial<StockSummary> | null;
  thinking: string;
  usage: RunStats | null;
  /** Date.now() when the lookup started, for the live timer. */
  startedAt: number | null;
  error: string | null;
}

const IDLE: StreamState = {
  phase: 'idle',
  status: '',
  news: null,
  summary: null,
  thinking: '',
  usage: null,
  startedAt: null,
  error: null,
};

/**
 * Consumes `GET /api/v1/stocks/{ticker}/summary/stream` (Server-Sent Events).
 * EventSource handles the stream lifecycle; Orval's generated MSW handler defines its E2E response.
 */
export function useSummaryStream() {
  const [state, setState] = useState<StreamState>(IDLE);
  const sourceRef = useRef<EventSource | null>(null);

  const stop = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const start = useCallback(
    (ticker: string) => {
      stop();
      setState({ ...IDLE, phase: 'fetching', startedAt: Date.now() });
      const source = new EventSource(
        apiUrl(`/api/v1/stocks/${encodeURIComponent(ticker)}/summary/stream`),
      );
      sourceRef.current = source;

      const on = <T>(name: string, handler: (data: T) => void) =>
        source.addEventListener(name, (e) => {
          if (sourceRef.current !== source) return;
          // "error" is two different things: our server sends an event named "error" (with JSON
          // data), and the browser fires its own "error" event, with no data, when the connection
          // drops. Only a message with data is ours; the other is handled by `onerror` below.
          const data = (e as MessageEvent).data;
          if (typeof data !== 'string') return;
          try {
            handler(JSON.parse(data) as T);
          } catch {
            setState((s) => ({
              ...s,
              phase: 'error',
              error: 'The server sent an invalid response.',
            }));
            stop();
          }
        });

      on('status', (d: { message: string }) =>
        setState((s) => ({
          ...s,
          status: d.message,
          phase: d.message === 'Summarising' ? 'summarising' : s.phase,
        })),
      );
      on('news', (d: NewsResponse) => setState((s) => ({ ...s, news: d })));
      on('summary', (d: Partial<StockSummary>) => setState((s) => ({ ...s, summary: d })));
      on('thinking', (d: { delta: string }) =>
        setState((s) => ({ ...s, thinking: s.thinking + d.delta })),
      );
      on('done', (d: { summary: StockSummary; usage: RunStats }) => {
        setState((s) => ({ ...s, phase: 'done', status: '', summary: d.summary, usage: d.usage }));
        stop();
      });
      on('error', (d: { message: string }) => {
        setState((s) => ({ ...s, phase: 'error', error: d.message }));
        stop();
      });
      // Network-level failure (backend down): EventSource would retry forever, so stop.
      source.onerror = () => {
        if (sourceRef.current !== source) return;
        setState((s) =>
          s.phase === 'done' || s.phase === 'error'
            ? s
            : { ...s, phase: 'error', error: 'Connection to the server was lost.' },
        );
        stop();
      };
    },
    [stop],
  );

  /** User pressed Stop: close the connection (the server then aborts the model call). */
  const cancel = useCallback(() => {
    stop();
    setState((s) =>
      s.phase === 'fetching' || s.phase === 'summarising'
        ? { ...s, phase: 'stopped', status: '' }
        : s,
    );
  }, [stop]);

  // Leaving the page (navigation, unmount) closes the stream too, which aborts the run.
  useEffect(() => stop, [stop]);

  return { state, start, stop, cancel };
}

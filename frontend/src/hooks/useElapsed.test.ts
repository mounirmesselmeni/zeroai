import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useElapsed } from './useElapsed';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

it('is zero before anything started', () => {
  const { result } = renderHook(() => useElapsed(null, false));
  expect(result.current).toBe(0);
});

it('ticks while running and freezes when stopped', () => {
  const start = Date.now();
  const { result, rerender } = renderHook(({ running }) => useElapsed(start, running), {
    initialProps: { running: true },
  });
  act(() => vi.advanceTimersByTime(1500));
  expect(result.current).toBeGreaterThanOrEqual(1500);
  rerender({ running: false });
  const frozen = result.current;
  act(() => vi.advanceTimersByTime(5000));
  expect(result.current).toBe(frozen);
});

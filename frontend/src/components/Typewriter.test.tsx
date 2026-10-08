import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTypewriter } from './Typewriter';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('types one character per tick and stops at the end', () => {
  const { result } = renderHook(() => useTypewriter('HELLO', { speed: 10 }));
  expect(result.current).toBe('');
  act(() => vi.advanceTimersByTime(10));
  expect(result.current).toBe('H');
  act(() => vi.advanceTimersByTime(20));
  expect(result.current).toBe('HEL');
  act(() => vi.advanceTimersByTime(500));
  expect(result.current).toBe('HELLO');
  expect(vi.getTimerCount()).toBe(0); // the interval cleaned itself up
});

it('starts over when the text changes', () => {
  const { result, rerender } = renderHook(({ text }) => useTypewriter(text, { speed: 10 }), {
    initialProps: { text: 'AAAA' },
  });
  act(() => vi.advanceTimersByTime(40));
  expect(result.current).toBe('AAAA');
  rerender({ text: 'BB' });
  expect(result.current).toBe('');
  act(() => vi.advanceTimersByTime(10));
  expect(result.current).toBe('B');
});

it('shows everything at once when disabled', () => {
  const { result } = renderHook(() => useTypewriter('INSTANT', { enabled: false }));
  expect(result.current).toBe('INSTANT');
  expect(vi.getTimerCount()).toBe(0);
});

it('shows everything at once for reduced motion', () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (q) =>
      ({
        matches: true,
        media: q,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
  const { result } = renderHook(() => useTypewriter('CALM'));
  expect(result.current).toBe('CALM');
});

it('cleans up the timer on unmount', () => {
  const { unmount } = renderHook(() => useTypewriter('LONG TEXT HERE', { speed: 10 }));
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

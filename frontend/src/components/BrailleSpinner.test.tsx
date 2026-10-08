import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '../test/render';
import { ASCII_FRAMES, BrailleSpinner, FRAMES } from './BrailleSpinner';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('cycles through the braille frames and wraps around', () => {
  render(<BrailleSpinner interval={80} />);
  const spinner = screen.getByTestId('spinner');
  expect(spinner).toHaveTextContent(FRAMES[0]);
  act(() => vi.advanceTimersByTime(80));
  expect(spinner).toHaveTextContent(FRAMES[1]);
  act(() => vi.advanceTimersByTime(80 * (FRAMES.length - 1)));
  expect(spinner).toHaveTextContent(FRAMES[0]);
});

it('is hidden from assistive tech and stops when unmounted', () => {
  const { unmount } = render(<BrailleSpinner />);
  expect(screen.getByTestId('spinner')).toHaveAttribute('aria-hidden', 'true');
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('stays still when the user prefers reduced motion', () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: true,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
  render(<BrailleSpinner />);
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByTestId('spinner')).toHaveTextContent(FRAMES[0]);
  vi.restoreAllMocks();
});

it('uses the classic | / - \\ shell spinner in the terminal theme', () => {
  render(<BrailleSpinner interval={80} />, { mode: 'terminal' });
  const spinner = screen.getByTestId('spinner');
  expect(spinner).toHaveTextContent(ASCII_FRAMES[0]);
  act(() => vi.advanceTimersByTime(80));
  expect(spinner).toHaveTextContent(ASCII_FRAMES[1]);
  act(() => vi.advanceTimersByTime(80 * (ASCII_FRAMES.length - 1)));
  expect(spinner).toHaveTextContent(ASCII_FRAMES[0]); // wraps
  expect(FRAMES).not.toContain(spinner.textContent);
});

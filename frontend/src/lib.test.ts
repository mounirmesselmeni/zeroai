import { expect, it } from 'vitest';
import { formatDuration, formatTokens } from './lib';

it('formats durations', () => {
  expect(formatDuration(0)).toBe('0 ms');
  expect(formatDuration(820.4)).toBe('820 ms');
  expect(formatDuration(4249)).toBe('4.2 s');
  expect(formatDuration(65_000)).toBe('1 m 05 s');
  expect(formatDuration(600_000)).toBe('10 m 00 s');
});

it('formats token counts with separators', () => {
  expect(formatTokens(1234567)).toBe('1,234,567');
  expect(formatTokens(0)).toBe('0');
});

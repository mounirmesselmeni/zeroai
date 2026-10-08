import { screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import { AsciiBar, asciiBar } from './Ascii';

it('draws proportional [|||....] bars', () => {
  expect(asciiBar(0, 10)).toBe('[..........]');
  expect(asciiBar(0.5, 10)).toBe('[|||||.....]');
  expect(asciiBar(1, 10)).toBe('[||||||||||]');
  expect(asciiBar(0.26, 10)).toBe('[|||.......]');
  expect(asciiBar(0.5)).toHaveLength(22); // default width 20 + brackets
});

it('clamps nonsense instead of drawing a broken bar', () => {
  expect(asciiBar(-3, 4)).toBe('[....]');
  expect(asciiBar(9, 4)).toBe('[||||]');
  expect(asciiBar(Number.NaN, 4)).toBe('[....]');
  expect(asciiBar(Number.POSITIVE_INFINITY, 4)).toBe('[....]');
});

it('labels a bar with its number', () => {
  renderWithProviders(<AsciiBar label="OUT" value={0.5} suffix="234" />);
  expect(screen.getByTestId('bar-OUT').textContent).toBe('OUT [||||||||||..........] 234');
});

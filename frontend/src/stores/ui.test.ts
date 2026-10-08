import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_UI, UI_STORAGE_KEY, useUiStore } from './ui';

const stored = () => JSON.parse(localStorage.getItem(UI_STORAGE_KEY) ?? 'null');

beforeEach(() => {
  localStorage.clear();
  useUiStore.setState({ ...DEFAULT_UI });
});

it('starts in the classic theme', () => {
  expect(useUiStore.getState().themeMode).toBe('classic');
  expect(DEFAULT_UI).toEqual({ themeMode: 'classic' });
});

it('a first-time visitor with nothing stored gets the default', async () => {
  await useUiStore.persist.rehydrate();
  expect(useUiStore.getState().themeMode).toBe('classic');
});

it('an explicit choice of classic is respected', async () => {
  localStorage.setItem(
    UI_STORAGE_KEY,
    JSON.stringify({ state: { themeMode: 'classic' }, version: 1 }),
  );
  await useUiStore.persist.rehydrate();
  expect(useUiStore.getState().themeMode).toBe('classic');
});

it('persists the theme to localStorage as JSON', () => {
  useUiStore.getState().setThemeMode('classic');
  expect(stored().state).toEqual({ themeMode: 'classic' });
  expect(stored().version).toBe(1);
});

it('never persists the actions, only data', () => {
  useUiStore.getState().toggleThemeMode();
  expect(Object.keys(stored().state)).toEqual(['themeMode']);
});

it('toggles back and forth', () => {
  const { toggleThemeMode } = useUiStore.getState();
  toggleThemeMode();
  expect(useUiStore.getState().themeMode).toBe('terminal');
  toggleThemeMode();
  expect(useUiStore.getState().themeMode).toBe('classic');
});

it.each([
  ['an unknown theme', { themeMode: 'neon' }, 'classic'],
  ['missing fields', {}, 'classic'],
  [
    'an older version that also stored a ticker',
    { themeMode: 'classic', lastTicker: 'AAPL' },
    'classic',
  ],
])('shrugs off %s in storage', async (_name, state, expected) => {
  localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ state, version: 1 }));
  await useUiStore.persist.rehydrate();
  expect(useUiStore.getState().themeMode).toBe(expected);
  expect(useUiStore.getState()).not.toHaveProperty('lastTicker');
});

it('survives storage that is not JSON at all', async () => {
  const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.setItem(UI_STORAGE_KEY, '{ definitely not json');
  await useUiStore.persist.rehydrate();
  expect(useUiStore.getState().themeMode).toBe('classic'); // falls back to the default
  warn.mockRestore();
});

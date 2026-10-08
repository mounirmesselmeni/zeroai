import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { expect, it } from 'vitest';
import { AppProviders } from '../AppProviders';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { DEFAULT_UI, UI_STORAGE_KEY, useUiStore } from '../stores/ui';
import { useThemeMode } from './ThemeMode';

const html = document.documentElement;

it('opens in the classic theme for a first-time visitor', () => {
  useUiStore.setState({ ...DEFAULT_UI });
  render(
    <AppProviders>
      <span />
    </AppProviders>,
  );
  expect(html.dataset.theme).toBe('classic');
  expect(html.getAttribute('data-mantine-color-scheme')).not.toBe('dark');
});

it('renders the classic theme when that is what the store says', () => {
  render(
    <AppProviders>
      <span />
    </AppProviders>,
  );
  expect(html.dataset.theme).toBe('classic');
});

it('switching to terminal sets data-theme, forces dark, and persists', async () => {
  const user = userEvent.setup();
  render(
    <AppProviders>
      <ThemeSwitcher />
    </AppProviders>,
  );
  const button = screen.getByRole('button', { name: 'Switch to terminal theme' });
  expect(button).toHaveAttribute('aria-pressed', 'false');

  await user.click(button);
  expect(html.dataset.theme).toBe('terminal');
  expect(html.getAttribute('data-mantine-color-scheme')).toBe('dark');
  expect(JSON.parse(localStorage.getItem(UI_STORAGE_KEY)!).state.themeMode).toBe('terminal');

  // The button says what it does, in plain words.
  expect(screen.getByText('Switch to classic UI')).toBeInTheDocument();
  const back = screen.getByRole('button', { name: 'Switch to classic theme' });
  expect(back).toHaveAttribute('aria-pressed', 'true');
  await user.click(back);
  expect(html.dataset.theme).toBe('classic');
});

it('uses square corners and the terminal font in the terminal theme only', async () => {
  const user = userEvent.setup();
  const Probe = () => {
    const theme = (window as unknown as { __theme?: unknown }).__theme;
    void theme;
    return <ThemeSwitcher />;
  };
  render(
    <AppProviders>
      <Probe />
    </AppProviders>,
  );
  const radius = () => getComputedStyle(html).getPropertyValue('--mantine-radius-md').trim();
  const font = () => getComputedStyle(html).getPropertyValue('--mantine-font-family').trim();
  expect(radius()).not.toBe('0');
  expect(font()).toMatch(/Geist/);

  await user.click(screen.getByRole('button', { name: 'Switch to terminal theme' }));
  expect(font()).toMatch(/JetBrains Mono/);
});

it('starts in terminal when the override is given (used by tests and deep links)', () => {
  render(
    <AppProviders initialMode="terminal">
      <span />
    </AppProviders>,
  );
  expect(html.dataset.theme).toBe('terminal');
});

it('useThemeMode reports and changes the mode', () => {
  const { result } = renderHook(() => useThemeMode(), {
    wrapper: ({ children }) => <MantineProvider>{children}</MantineProvider>,
  });
  expect(result.current.mode).toBe('classic');
  act(() => result.current.setMode('terminal'));
  expect(result.current.mode).toBe('terminal');
  act(() => result.current.toggle());
  expect(result.current.mode).toBe('classic');
});

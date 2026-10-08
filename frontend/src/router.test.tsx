import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { AppProviders } from './AppProviders';
import { router } from './router';

vi.mock('./api/axios-instance', () => ({ customInstance: async () => [] }));

it('navigates between the summary and sources pages', async () => {
  const user = userEvent.setup();
  router.update({ history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  expect(await screen.findByLabelText('Ticker')).toBeInTheDocument();
  await user.click(screen.getByRole('link', { name: 'Sources' }));
  expect(await screen.findByText('News sources')).toBeInTheDocument();
  await user.click(screen.getByRole('link', { name: 'Settings' }));
  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  await user.click(screen.getByRole('link', { name: 'Summary' }));
  expect(await screen.findByLabelText('Ticker')).toBeInTheDocument();
});

it('toggles the color scheme', async () => {
  const user = userEvent.setup();
  router.update({ history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  const toggle = await screen.findByRole('button', { name: 'Toggle color scheme' });
  await user.click(toggle);
  const first = document.documentElement.getAttribute('data-mantine-color-scheme');
  await user.click(toggle);
  expect(document.documentElement.getAttribute('data-mantine-color-scheme')).not.toBe(first);
});

it('swaps the brand and drops the light/dark toggle in the terminal theme', async () => {
  const user = userEvent.setup();
  router.update({ history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  expect(await screen.findByTestId('brand')).toHaveTextContent('ZeroAI');
  expect(screen.getByRole('button', { name: 'Toggle color scheme' })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Switch to terminal theme' }));
  expect(screen.getByTestId('brand')).toHaveTextContent('ZEROAI_');
  expect(screen.queryByRole('button', { name: 'Toggle color scheme' })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Switch to classic theme' }));
  expect(screen.getByTestId('brand')).toHaveTextContent('ZeroAI');
  expect(screen.getByRole('button', { name: 'Toggle color scheme' })).toBeInTheDocument();
});

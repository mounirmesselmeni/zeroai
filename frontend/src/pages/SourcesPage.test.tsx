import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosRequestConfig } from 'axios';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render';
import { hoverTooltip } from '../test/tooltip';
import { SourcesPage } from './SourcesPage';

interface Source {
  id: number;
  name: string;
  url_template: string;
  enabled: boolean;
}
let db: Source[] = [];
let nextId = 1;
let failGet = false;
let failWrite = false;

// An in-memory backend behind the Orval mutator.
vi.mock('../api/axios-instance', () => ({
  customInstance: async (config: AxiosRequestConfig) => {
    if (config.method?.toLowerCase() !== 'get' && failWrite) throw new Error('offline');
    const id = Number(config.url?.split('/').pop());
    switch (config.method?.toLowerCase()) {
      case 'get':
        if (failGet) throw new Error('offline');
        return db;
      case 'post': {
        if (config.url?.endsWith('/check')) {
          const { url_template } = config.data as { url_template: string };
          return url_template.includes('cnn.test')
            ? {
                ok: false,
                kind: null,
                item_count: 0,
                sample: [],
                error: 'this is a web page, not an RSS/Atom feed',
              }
            : {
                ok: true,
                kind: 'rss',
                item_count: 15,
                sample: ['Apple unveils chip'],
                error: null,
              };
        }
        const created = { id: nextId++, enabled: true, ...(config.data as object) } as Source;
        db.push(created);
        return created;
      }
      case 'patch': {
        const row = db.find((s) => s.id === id)!;
        Object.assign(row, config.data);
        return row;
      }
      case 'delete':
        db = db.filter((s) => s.id !== id);
        return undefined;
    }
  },
}));

beforeEach(() => {
  db = [{ id: 100, name: 'Yahoo', url_template: 'https://y.test/{ticker}', enabled: true }];
  nextId = 1;
  failGet = false;
  failWrite = false;
});

it('recovers a failed sources query through Retry', async () => {
  failGet = true;
  const user = userEvent.setup();
  renderWithProviders(<SourcesPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load sources');
  failGet = false;
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Yahoo')).toBeInTheDocument();
});

it('shows failed source changes without removing the saved source', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SourcesPage />);
  await screen.findByText('Yahoo');
  failWrite = true;
  await user.click(screen.getByRole('button', { name: 'Delete Yahoo' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The change was not saved');
  expect(screen.getByText('Yahoo')).toBeInTheDocument();
});

it('lists, toggles, adds and deletes sources', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SourcesPage />);
  expect(await screen.findByText('Yahoo')).toBeInTheDocument();

  await user.click(screen.getByRole('switch', { name: 'Enable Yahoo' }));
  await waitFor(() => expect(db[0].enabled).toBe(false));

  await user.type(screen.getByLabelText('Name'), 'Mine');
  await user.type(screen.getByLabelText('Feed URL'), 'https://m.test/rss?s={{}ticker}');
  await user.click(screen.getByRole('button', { name: 'Add source' }));
  expect(await screen.findByText('Mine')).toBeInTheDocument();
  expect(screen.getByLabelText('Name')).toHaveValue('');

  await user.click(screen.getByRole('button', { name: 'Delete Yahoo' }));
  await waitFor(() => expect(screen.queryByText('Yahoo')).not.toBeInTheDocument());
});

it('validates the form before submitting', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SourcesPage />);
  await screen.findByText('Yahoo');
  await user.type(screen.getByLabelText('Feed URL'), 'ftp://nope');
  await user.click(screen.getByRole('button', { name: 'Add source' }));
  expect(screen.getByText('Name is required')).toBeInTheDocument();
  expect(screen.getByText('Must start with http:// or https://')).toBeInTheDocument();
  expect(db).toHaveLength(1);
});

it('tests a feed before adding it and explains why a web page does not work', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SourcesPage />);
  await screen.findByText('Yahoo');
  const test = screen.getByRole('button', { name: 'Test feed' });
  expect(test).toBeDisabled(); // nothing to test yet

  await user.type(screen.getByLabelText('Feed URL'), 'https://cnn.test/markets/{{}ticker}');
  expect(test).toBeEnabled();
  await user.click(test);
  const bad = await screen.findByTestId('check-form');
  expect(bad).toHaveTextContent('Does not work: this is a web page, not an RSS/Atom feed');
  expect(db).toHaveLength(1); // testing never adds the source

  await user.clear(screen.getByLabelText('Feed URL'));
  await user.type(screen.getByLabelText('Feed URL'), 'https://good.test/rss?s={{}ticker}');
  await user.click(test);
  await waitFor(() =>
    expect(screen.getByTestId('check-form')).toHaveTextContent(
      'RSS feed, 15 items. For example: "Apple unveils chip"',
    ),
  );
});

it('can test a source that is already saved', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SourcesPage />);
  await user.click(await screen.findByRole('button', { name: 'Test Yahoo' }));
  expect(await screen.findByTestId('check-100')).toHaveTextContent('RSS feed, 15 items');
});

it('explains the "off" badge on a disabled source', async () => {
  db[0].enabled = false;
  const user = userEvent.setup();
  renderWithProviders(<SourcesPage />);
  expect(await hoverTooltip(user, await screen.findByText('off'))).toHaveTextContent(
    'this feed is skipped when fetching news',
  );
});

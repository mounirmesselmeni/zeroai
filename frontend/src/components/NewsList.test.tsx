import { screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import { NewsList } from './NewsList';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const item = (title: string, published?: string) => ({
  title,
  link: `https://x.test/${title}`,
  source: 'S',
  snippet: '',
  published,
});

it('shows relative publication times', () => {
  renderWithProviders(
    <NewsList
      news={{
        ticker: 'X',
        errors: [],
        items: [
          item('now', ago(5_000)),
          item('mins', ago(5 * 60_000)),
          item('hours', ago(3 * 3_600_000)),
          item('old', ago(5 * 86_400_000)),
          item('undated'),
        ],
      }}
    />,
  );
  expect(screen.getByText('just now')).toBeInTheDocument();
  expect(screen.getByText('5 min ago')).toBeInTheDocument();
  expect(screen.getByText('3 h ago')).toBeInTheDocument();
  expect(screen.getByText(new Date(ago(5 * 86_400_000)).toLocaleDateString())).toBeInTheDocument();
  expect(screen.queryByText(/Some sources failed/)).not.toBeInTheDocument();
});

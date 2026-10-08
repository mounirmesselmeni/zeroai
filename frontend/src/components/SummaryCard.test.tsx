import { screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import { SummaryCard } from './SummaryCard';

it('shows a skeleton while nothing has streamed yet', () => {
  renderWithProviders(<SummaryCard ticker="X" summary={null} streaming />);
  expect(screen.getByLabelText('AI summary')).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByTestId('sentiment')).not.toBeInTheDocument();
});

it('renders an empty, finished card without optional sections', () => {
  renderWithProviders(<SummaryCard ticker="X" summary={{ headline: 'h' }} streaming={false} />);
  expect(screen.getByText('h')).toBeInTheDocument();
  expect(screen.queryByLabelText('Risks')).not.toBeInTheDocument();
});

it.each(['bullish', 'bearish', 'neutral', 'mixed'] as const)('renders %s sentiment', (s) => {
  renderWithProviders(
    <SummaryCard
      ticker="X"
      streaming={false}
      summary={{ headline: 'h', sentiment: s, key_points: ['k'], risks: ['r'], outlook: 'o' }}
    />,
  );
  expect(screen.getByTestId('sentiment')).toHaveTextContent(s);
  expect(screen.getByLabelText('AI summary')).toHaveAttribute('data-sentiment', s);
});

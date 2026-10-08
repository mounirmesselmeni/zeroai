import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import { findOpenTooltip, hoverTooltip } from '../test/tooltip';
import { InfoBadge } from './InfoBadge';
import { NewsList } from './NewsList';
import { SummaryCard } from './SummaryCard';

const usage = {
  provider: 'ollama',
  model: 'gpt-oss:120b-cloud',
  input_tokens: 1000,
  output_tokens: 234,
  total_tokens: 1234,
  requests: 1,
  duration_ms: 4249,
};

it('shows its explanation on hover', async () => {
  const user = userEvent.setup();
  renderWithProviders(<InfoBadge tip="What this means">label</InfoBadge>);
  expect(await hoverTooltip(user, screen.getByText('label'))).toHaveTextContent('What this means');
});

it('is keyboard reachable and explains itself on focus', async () => {
  const user = userEvent.setup();
  renderWithProviders(<InfoBadge tip="What this means">label</InfoBadge>);
  await user.tab();
  expect(screen.getByText('label').closest('[tabindex="0"]')).toHaveFocus();
  expect(await findOpenTooltip()).toHaveTextContent('What this means');
});

it.each([
  ['bullish', /news leans positive/],
  ['bearish', /news leans negative/],
  ['neutral', /routine or balanced/],
  ['mixed', /good and bad news at the same time/],
] as const)('explains the %s sentiment badge', async (sentiment, text) => {
  const user = userEvent.setup();
  renderWithProviders(
    <SummaryCard ticker="X" streaming={false} summary={{ headline: 'h', sentiment }} />,
  );
  const tip = await hoverTooltip(user, screen.getByTestId('sentiment'));
  expect(tip).toHaveTextContent(text);
  expect(tip).toHaveTextContent(/not a prediction/);
});

it('explains the time and token badges with the actual numbers', async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <SummaryCard ticker="X" streaming={false} summary={{ headline: 'h' }} usage={usage} />,
  );
  expect(await hoverTooltip(user, screen.getByText('4.2 s'))).toHaveTextContent(
    /from pressing Summarise to the finished answer.*fetching the news/,
  );

  const tokens = await hoverTooltip(user, screen.getByText('1,234 tokens'));
  expect(tokens).toHaveTextContent('Input 1,000');
  expect(tokens).toHaveTextContent('output 234');
  expect(tokens).toHaveTextContent('= 1,234');
  expect(tokens).toHaveTextContent('Model calls made: 1.');
  expect(tokens).not.toHaveTextContent('retry');
});

it('says when the model had to retry', async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <SummaryCard
      ticker="X"
      streaming={false}
      summary={{ headline: 'h' }}
      usage={{ ...usage, requests: 3 }}
    />,
  );
  expect(await hoverTooltip(user, screen.getByText('1,234 tokens'))).toHaveTextContent(
    'Model calls made: 3 (it had to retry)',
  );
});

it('explains where a headline came from', async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <NewsList
      news={{
        ticker: 'X',
        errors: [],
        items: [{ title: 'T', link: 'https://x.test/t', source: 'Yahoo Finance', snippet: '' }],
      }}
    />,
  );
  expect(await hoverTooltip(user, screen.getByText('Yahoo Finance'))).toHaveTextContent(
    'came from the "Yahoo Finance" feed',
  );
});

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import { ThinkingPanel } from './ThinkingPanel';

it('is open and animated while streaming', () => {
  renderWithProviders(<ThinkingPanel text="hmm" streaming />);
  expect(screen.getByRole('button', { name: /Thinking/ })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByTestId('spinner')).toBeInTheDocument();
});

it('can be toggled by the user once finished', async () => {
  const user = userEvent.setup();
  renderWithProviders(<ThinkingPanel text="because" streaming={false} />);
  const toggle = screen.getByRole('button', { name: /Reasoning/ });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByTestId('thinking-text')).toHaveTextContent('because');
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

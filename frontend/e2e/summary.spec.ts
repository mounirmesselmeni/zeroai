import { expect, test } from './fixtures';
import { NEWS, SUMMARY, USAGE, sse, stubStream } from './helpers';

test('shows an AI briefing with its source articles', async ({ page }) => {
  await stubStream(
    page,
    sse([
      ['status', { message: 'Fetching news for AAPL' }],
      ['news', NEWS],
      ['status', { message: 'Summarising' }],
      ['thinking', { delta: 'Weighing the ' }],
      ['thinking', { delta: 'headlines.' }],
      ['summary', { headline: 'Apple unveiled' }],
      ['done', { summary: SUMMARY, usage: USAGE }],
    ]),
  );
  await page.goto('/');
  await page.getByLabel('Ticker').fill('aapl');
  await page.getByRole('button', { name: 'Summarise' }).click();

  await expect(page.getByText(SUMMARY.headline)).toBeVisible();
  await expect(page.getByTestId('sentiment')).toHaveText('bullish');
  await expect(page.getByLabel('Key points')).toContainText('Analysts upbeat');
  await expect(page.getByLabel('Risks')).toContainText('Supply constraints');
  const stats = page.getByTestId('run-stats');
  await expect(stats).toContainText('4.2 s');
  await expect(stats).toContainText('1,234 tokens');
  await expect(stats).toContainText('qwen3:latest');

  // The reasoning is kept, collapsed, and can be reopened.
  const reasoning = page.getByRole('button', { name: /Reasoning/ });
  await expect(reasoning).toHaveAttribute('aria-expanded', 'false');
  await reasoning.click();
  await expect(page.getByTestId('thinking-text')).toContainText('Weighing the headlines.');

  await expect(page.getByRole('link', { name: 'Apple unveils new chip' })).toHaveAttribute(
    'href',
    'https://example.com/apple-chip',
  );
});

test('surfaces a stream error', async ({ page }) => {
  await stubStream(
    page,
    sse([
      ['status', { message: 'Fetching news for ZZZZ' }],
      ['error', { message: 'No recent news found for ZZZZ.' }],
    ]),
  );
  await page.goto('/');
  await page.getByLabel('Ticker').fill('zzzz');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('No recent news found for ZZZZ.');
});

import { expect, test } from './fixtures';
import { NEWS, SUMMARY, USAGE, configureApi, sse, stubStream } from './helpers';

test('streams a briefing and shows its usage on the settings page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await configureApi(page, {
    usage: [
      {
        provider: 'ollama',
        model: 'browser-model',
        runs: 1,
        requests: 2,
        input_tokens: 12,
        output_tokens: 8,
        total_tokens: 20,
        avg_duration_ms: 100,
        last_used: '2026-10-07T10:00:00Z',
      },
    ],
  });
  await stubStream(
    page,
    sse([
      ['status', { message: 'Summarising' }],
      ['news', NEWS],
      ['summary', { headline: 'Browser integration headline' }],
      [
        'done',
        {
          summary: { ...SUMMARY, headline: 'Integration briefing complete' },
          usage: { ...USAGE, model: 'browser-model' },
        },
      ],
    ]),
  );
  await page.goto('/');
  await page.getByLabel('Ticker').fill('AAPL');
  await page.getByRole('button', { name: 'Summarise' }).click();
  await expect(page.getByText('Integration briefing complete')).toBeVisible();
  await expect(page.getByLabel('Key points')).toContainText('New chip announced');
  await expect(page.getByRole('link', { name: 'Apple unveils new chip' })).toBeVisible();
  await expect(page.getByTestId('run-stats')).toContainText('browser-model');
  expect(errors).toEqual([]);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Usage per model' })).toContainText('browser-model');
});

test('shows an API error event without depending on a server', async ({ page }) => {
  await stubStream(
    page,
    sse([['error', { message: 'Add an OpenAI API key on the Settings page.' }]]),
  );
  await page.goto('/');
  await page.getByLabel('Ticker').fill('NOKEY');
  await page.getByRole('button', { name: 'Summarise' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Add an OpenAI API key on the Settings page.',
  );
  await expect(page.getByRole('button', { name: 'Summarise' })).toBeEnabled();
});

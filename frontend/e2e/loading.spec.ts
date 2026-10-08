import { expect, test } from './fixtures';
import { NEWS, SUMMARY, USAGE, sse, stubSettings, stubStream } from './helpers';

const settings = {
  provider: 'ollama' as const,
  model: 'gpt-oss:120b-cloud',
  base_url: 'http://localhost:11434/v1',
  thinking: true,
  thinking_effort: 'high' as const,
  api_key_set: false,
};

test('skeleton cards stand in for the article sources until they arrive', async ({ page }) => {
  await stubStream(
    page,
    sse([
      ['news', NEWS],
      ['done', { summary: SUMMARY, usage: USAGE }],
    ]),
    1200,
  );
  await page.goto('/');
  await page.getByLabel('Ticker').fill('aapl');
  await page.keyboard.press('Enter');

  const skeleton = page.getByTestId('news-skeleton');
  await expect(skeleton).toBeVisible();
  await expect(skeleton).toHaveAttribute('aria-busy', 'true');
  expect(await skeleton.locator('.mantine-Skeleton-root').count()).toBeGreaterThan(5);

  // The real articles replace them.
  await expect(page.getByRole('link', { name: 'Apple unveils new chip' })).toBeVisible();
  await expect(skeleton).toHaveCount(0);
});

test('the settings form shows placeholders, not empty inputs, while it loads', async ({ page }) => {
  await stubSettings(page, settings, 900);
  await page.goto('/settings');
  await expect(page.getByTestId('settings-skeleton')).toBeVisible();
  await expect(page.getByLabel('Base URL')).toHaveCount(0); // no empty-looking input yet

  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('gpt-oss:120b-cloud');
  await expect(page.getByLabel('Base URL')).toHaveValue('http://localhost:11434/v1');
  await expect(page.getByTestId('settings-skeleton')).toHaveCount(0);
});

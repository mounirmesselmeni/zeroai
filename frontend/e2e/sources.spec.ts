import { expect, test } from './fixtures';
import { getApiState, stubSources } from './helpers';

test('manages news sources', async ({ page }) => {
  await stubSources(page, [
    { id: 1, name: 'Yahoo Finance', url_template: 'https://y.test/{ticker}', enabled: true },
  ]);
  await page.goto('/');
  await page.getByRole('link', { name: 'Sources' }).click();
  await expect(page.getByText('Yahoo Finance')).toBeVisible();

  await page.getByLabel('Name').fill('My feed');
  await page.getByLabel('Feed URL').fill('https://my.test/rss?s={ticker}');
  await page.getByRole('button', { name: 'Add source' }).click();
  await expect(page.getByText('My feed', { exact: true })).toBeVisible();
  expect((await getApiState(page)).sources.map((s) => s.name)).toEqual([
    'Yahoo Finance',
    'My feed',
  ]);

  await page.getByRole('switch', { name: 'Enable Yahoo Finance' }).click({ force: true });
  await expect.poll(async () => (await getApiState(page)).sources[0].enabled).toBe(false);

  await page.getByRole('button', { name: 'Delete My feed' }).click();
  await expect(page.getByText('My feed', { exact: true })).toHaveCount(0);
});

test('rejects a non-http feed URL client-side', async ({ page }) => {
  await stubSources(page, []);
  await page.goto('/sources');
  await page.getByLabel('Name').fill('Bad');
  await page.getByLabel('Feed URL').fill('file:///etc/passwd');
  await page.getByRole('button', { name: 'Add source' }).click();
  await expect(page.getByText('Must start with http:// or https://')).toBeVisible();
});

test('tests a feed URL and explains a web page is not a feed', async ({ page }) => {
  await stubSources(page, []);
  await page.goto('/sources');
  await page.getByLabel('Feed URL').fill('https://edition.cnn.com/markets/stocks/{ticker}');
  await page.getByRole('button', { name: 'Test feed' }).click();
  await expect(page.getByTestId('check-form')).toContainText(
    'this is a web page, not an RSS/Atom feed',
  );
  await page.getByLabel('Feed URL').fill('http://rss.cnn.com/rss/money_markets.rss');
  await page.getByRole('button', { name: 'Test feed' }).click();
  await expect(page.getByTestId('check-form')).toContainText('RSS feed, 15 items');
});

import { expect, test } from './fixtures';
import { sse, stubStream } from './helpers';

test('an SSE error shows a clear message and throws nothing in the page', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  // An SSE error event exercises the same user-visible failure state through the generated mock.
  await stubStream(page, sse([['error', { message: 'Connection to the server was lost.' }]]));
  await page.goto('/');
  await page.getByLabel('Ticker').fill('aapl');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('alert')).toContainText('Connection to the server was lost.');
  expect(pageErrors).toEqual([]);
});

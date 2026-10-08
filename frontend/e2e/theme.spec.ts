import { expect, test } from './fixtures';
import { NEWS, SUMMARY, USAGE, sse, stubStream } from './helpers';

const css = (page: import('@playwright/test').Page, selector: string, prop: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

// A first-time visitor: no stored preferences at all.
test.describe('first visit', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('opens in the classic theme, with an empty, focused ticker box', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
    expect(await css(page, 'body', 'background-color')).not.toBe('rgb(10, 10, 10)');
    expect(await css(page, '.mantine-Button-root', 'font-family')).toContain('Geist');
    expect(await css(page, '.mantine-Button-root', 'border-radius')).not.toBe('0px');
    await expect(page.getByTestId('brand')).toHaveText('ZeroAI');
    await expect(page.getByRole('button', { name: 'Toggle color scheme' })).toBeVisible();

    // The wordmark lives in the header only: the hero has no second ZEROAI.
    await expect(page.getByRole('img', { name: 'ZeroAI' })).toHaveCount(0);
    expect(await page.locator('.hero').innerText()).not.toMatch(/zeroai/i);

    // The ticker box starts empty and focused, so you can just start typing. Summarise is
    // unavailable until there is something to summarise.
    await expect(page.getByLabel('Ticker')).toHaveValue('');
    await expect(page.getByLabel('Ticker')).toBeFocused();
    await expect(page.getByRole('button', { name: /Summarise/ })).toBeDisabled();

    // Classic has no terminal scanline overlay.
    expect(await page.evaluate(() => getComputedStyle(document.body, '::after').content)).toBe(
      'none',
    );
  });

  test('the switch says what it does, flips to terminal, and the choice survives a reload', async ({
    page,
  }) => {
    await page.goto('/');
    const toTerminal = page.getByRole('button', { name: 'Switch to terminal theme' });
    await expect(toTerminal).toContainText(/geek mode/i);
    await toTerminal.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'terminal');
    expect(await css(page, '.mantine-Button-root', 'border-radius')).toBe('0px');
    await expect(page.getByRole('button', { name: 'Toggle color scheme' })).toHaveCount(0);

    // Stored by the Zustand store, and applied again after a reload (no flash of the default).
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('zeroai-ui')!));
    expect(stored.state.themeMode).toBe('terminal');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'terminal');
    expect(await css(page, 'body', 'background-color')).toBe('rgb(10, 10, 10)');

    // And back to the default Classic look.
    await page.getByRole('button', { name: 'Switch to classic theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
  });
});

test('the terminal theme styles a finished briefing: badges, buttons, bars', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'zeroai-ui',
      JSON.stringify({ state: { themeMode: 'terminal' }, version: 1 }),
    ),
  );
  await stubStream(
    page,
    sse([
      ['news', NEWS],
      ['done', { summary: SUMMARY, usage: USAGE }],
    ]),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'AAPL' }).click();

  await expect(page.getByTestId('status-ok')).toContainText('[OK] briefing complete in 4.2 s');
  await expect(page.getByTestId('bar-IN')).toContainText('[||||||||||||||||||||]');
  await expect(page.getByTestId('bar-OUT')).toContainText('[||||');

  // Badge text must be fully visible, with the brackets around it and not squeezing it.
  const badge = page.getByTestId('sentiment');
  await expect(badge).toBeVisible();
  const { scrollWidth, clientWidth } = await badge
    .locator('.mantine-Badge-label')
    .evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  const label = await badge
    .locator('.mantine-Badge-label')
    .evaluate((el) => getComputedStyle(el, '::before').content);
  expect(label).toContain('[');

  // Buttons are bracketed; a disabled one is dashed and readable.
  const summarise = page.getByRole('button', { name: /Summarise/ });
  expect(
    await summarise
      .locator('.mantine-Button-inner')
      .evaluate((el) => getComputedStyle(el, '::before').content),
  ).toContain('[');
  await page.getByLabel('Ticker').fill('');
  await expect(summarise).toBeDisabled();
  expect(await summarise.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('dashed');
});

test('the terminal header stays on one line on a phone', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'zeroai-ui',
      JSON.stringify({ state: { themeMode: 'terminal' }, version: 1 }),
    ),
  );
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  const heights = await page
    .locator('.navlink')
    .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  expect(Math.max(...heights)).toBeLessThan(40); // one line each, not "./SU MMAR Y"
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

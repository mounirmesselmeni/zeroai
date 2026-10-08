import { expect, test } from './fixtures';
import { getApiState, stubSettings } from './helpers';

test('configures the model and shows token usage', async ({ page }) => {
  await stubSettings(page, {
    provider: 'ollama',
    model: 'gpt-oss:120b-cloud',
    base_url: 'http://localhost:11434/v1',
    thinking: true,
    thinking_effort: 'high',
    api_key_set: false,
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Settings' }).click();

  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('gpt-oss:120b-cloud');
  const usage = page.getByRole('table', { name: 'Usage per model' });
  await expect(usage).toContainText('2,468');
  await expect(usage).toContainText('4.0 s');

  // Effort is chosen while thinking is on.
  await page.getByRole('radiogroup', { name: 'Thinking effort' }).getByText('Medium').click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect
    .poll(async () => (await getApiState(page)).lastSettingsPut?.thinking_effort)
    .toBe('medium');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.waitForTimeout(300); // let the refetch settle before editing again

  // Thinking mode can be switched off for local models, with a caution shown.
  await expect(page.getByTestId('thinking-note')).toContainText('turn this off');
  await page.getByRole('switch', { name: /Thinking mode/ }).click({ force: true });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await getApiState(page)).lastSettingsPut?.thinking).toBe(false);

  await page.getByText('OpenAI', { exact: true }).click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('gpt-4o-mini');
  await page.getByLabel('API key').fill('sk-test');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  expect((await getApiState(page)).lastSettingsPut).toMatchObject({
    provider: 'openai',
    model: 'gpt-4o-mini',
    base_url: null,
    api_key: 'sk-test',
  });
  await expect(page.getByLabel('API key')).toHaveValue('');
});

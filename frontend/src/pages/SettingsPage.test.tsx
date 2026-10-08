import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosRequestConfig } from 'axios';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render';
import { SettingsPage } from './SettingsPage';

let config: {
  provider: string;
  model: string;
  base_url: string | null;
  thinking: boolean;
  thinking_effort: string;
  api_key_set: boolean;
};
let lastPut: Record<string, unknown> | null;
let usage: unknown[];
let runs: unknown[];
let failPut = false;
let failGet = false;
let failUsage = false;

vi.mock('../api/axios-instance', () => ({
  customInstance: async (c: AxiosRequestConfig) => {
    const url = c.url ?? '';
    if (url.endsWith('/settings/llm')) {
      if (c.method?.toLowerCase() === 'get' && failGet) throw new Error('offline');
      if (c.method?.toLowerCase() === 'put') {
        if (failPut) throw new Error('boom');
        lastPut = c.data as Record<string, unknown>;
        const d = lastPut as {
          provider: string;
          model: string;
          base_url: string | null;
          api_key?: string;
          thinking?: boolean;
          thinking_effort?: string;
        };
        config = {
          provider: d.provider,
          model: d.model,
          base_url: d.base_url,
          thinking: d.thinking ?? config.thinking,
          thinking_effort: d.thinking_effort ?? config.thinking_effort,
          api_key_set: d.api_key === undefined ? config.api_key_set : d.api_key !== '',
        };
      }
      return config;
    }
    if (url.includes('/usage') && failUsage) throw new Error('offline');
    if (url.endsWith('/usage/runs')) return runs;
    if (url.endsWith('/usage')) return usage;
  },
}));

beforeEach(() => {
  failPut = false;
  failGet = false;
  failUsage = false;
  lastPut = null;
  config = {
    provider: 'ollama',
    model: 'gpt-oss:120b-cloud',
    base_url: 'http://localhost:11434/v1',
    thinking: true,
    thinking_effort: 'high',
    api_key_set: false,
  };
  usage = [];
  runs = [];
});

it('shows a settings load error and recovers on retry', async () => {
  failGet = true;
  const user = userEvent.setup();
  renderWithProviders(<SettingsPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load model settings');
  expect(screen.queryByTestId('settings-skeleton')).not.toBeInTheDocument();
  failGet = false;
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByLabelText('Model')).toHaveValue(config.model);
});

it('reports usage load failures and retries both queries', async () => {
  failUsage = true;
  const user = userEvent.setup();
  renderWithProviders(<SettingsPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load token usage');
  failUsage = false;
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(/No runs yet/)).toBeInTheDocument();
});

it('loads the stored model config and saves edits', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SettingsPage />);
  const model = await screen.findByLabelText('Model');
  await waitFor(() => expect(model).toHaveValue('gpt-oss:120b-cloud'));
  // The key is optional for Ollama (remote/cloud hosts), so the field is always there.
  expect(screen.getByLabelText('API key')).toHaveAttribute(
    'placeholder',
    'Leave empty for a local Ollama',
  );

  await user.clear(model);
  await user.type(model, 'llama3.2');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Saved')).toBeInTheDocument();
  expect(lastPut).toEqual({
    provider: 'ollama',
    model: 'llama3.2',
    base_url: 'http://localhost:11434/v1',
    thinking: true,
    thinking_effort: 'high',
    api_key: undefined,
  });
});

it('switching to OpenAI applies defaults and sends the API key', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SettingsPage />);
  await waitFor(() => expect(screen.getByLabelText('Model')).toHaveValue('gpt-oss:120b-cloud'));
  await user.click(screen.getByText('OpenAI'));
  expect(screen.getByLabelText('Model')).toHaveValue('gpt-4o-mini');
  expect(screen.getByLabelText('Base URL')).toHaveValue('');

  await user.type(screen.getByLabelText('API key'), 'sk-secret');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Saved');
  expect(lastPut).toMatchObject({
    provider: 'openai',
    model: 'gpt-4o-mini',
    base_url: null,
    api_key: 'sk-secret',
  });
  // The key is never shown again; the field is cleared and a saved hint appears.
  await waitFor(() => expect(screen.getByLabelText('API key')).toHaveValue(''));
  expect(screen.getByLabelText('API key')).toHaveAttribute(
    'placeholder',
    expect.stringContaining('saved'),
  );
});

it('can remove a saved key', async () => {
  config = {
    provider: 'openai',
    model: 'gpt-4o',
    base_url: null,
    thinking: true,
    thinking_effort: 'high',
    api_key_set: true,
  };
  const user = userEvent.setup();
  renderWithProviders(<SettingsPage />);
  await user.click(await screen.findByRole('button', { name: 'Remove the saved key' }));
  expect(screen.getByLabelText('API key')).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Saved');
  expect(lastPut).toMatchObject({ api_key: '' });
  expect(await screen.findByLabelText('API key')).not.toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Remove the saved key' })).not.toBeInTheDocument();
});

it('validates before saving and reports server errors', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SettingsPage />);
  const model = await screen.findByLabelText('Model');
  await waitFor(() => expect(model).toHaveValue('gpt-oss:120b-cloud'));
  await user.clear(model);
  await user.clear(screen.getByLabelText('Base URL'));
  await user.type(screen.getByLabelText('Base URL'), 'ftp://x');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByText('Model is required')).toBeInTheDocument();
  expect(screen.getByText('Must start with http:// or https://')).toBeInTheDocument();
  expect(lastPut).toBeNull();

  failPut = true;
  await user.type(model, 'm');
  await user.clear(screen.getByLabelText('Base URL'));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
});

it('shows an empty state, then per-model usage and recent runs', async () => {
  const { unmount } = renderWithProviders(<SettingsPage />);
  expect(await screen.findByText(/No runs yet/)).toBeInTheDocument();
  unmount();

  usage = [
    {
      provider: 'ollama',
      model: 'qwen3:latest',
      runs: 3,
      requests: 3,
      input_tokens: 3000,
      output_tokens: 900,
      total_tokens: 3900,
      avg_duration_ms: 4200,
      last_used: '2026-10-07T10:00:00Z',
    },
  ];
  runs = [
    {
      id: 1,
      ticker: 'AAPL',
      created_at: '2026-10-07T10:00:00Z',
      provider: 'ollama',
      model: 'qwen3:latest',
      input_tokens: 1000,
      output_tokens: 300,
      total_tokens: 1300,
      requests: 1,
      duration_ms: 3100,
    },
  ];
  renderWithProviders(<SettingsPage />);
  const table = await screen.findByRole('table', { name: 'Usage per model' });
  expect(within(table).getByText('3,900')).toBeInTheDocument();
  expect(within(table).getByText('4.2 s')).toBeInTheDocument();
  const recent = await screen.findByRole('table', { name: 'Recent runs' });
  expect(within(recent).getByText('AAPL')).toBeInTheDocument();
  expect(within(recent).getByText('1,300 tokens')).toBeInTheDocument();
});

it('lets you turn thinking mode off, with a caution about local models', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SettingsPage />);
  const toggle = await screen.findByRole('switch', { name: /Thinking mode/ });
  await waitFor(() => expect(toggle).toBeChecked());
  expect(screen.getByTestId('thinking-note')).toHaveTextContent(/slower/);
  expect(screen.getByTestId('thinking-note')).toHaveTextContent(/turn this\s+off/);

  await user.click(toggle);
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Saved');
  expect(lastPut).toMatchObject({ thinking: false });
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: /Thinking mode/ })).not.toBeChecked(),
  );
});

it('hides the thinking switch for OpenAI, which has no local reasoning toggle', async () => {
  config = {
    provider: 'openai',
    model: 'gpt-4o',
    base_url: null,
    thinking: true,
    thinking_effort: 'high',
    api_key_set: false,
  };
  renderWithProviders(<SettingsPage />);
  await waitFor(() => expect(screen.getByLabelText('Model')).toHaveValue('gpt-4o'));
  expect(screen.queryByRole('switch', { name: /Thinking mode/ })).not.toBeInTheDocument();
});

it('sends an API token for Ollama too, write-only like the OpenAI key', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SettingsPage />);
  await waitFor(() => expect(screen.getByLabelText('Model')).toHaveValue('gpt-oss:120b-cloud'));
  await user.clear(screen.getByLabelText('Base URL'));
  await user.type(screen.getByLabelText('Base URL'), 'https://ollama.com/v1');
  await user.type(screen.getByLabelText('API key'), 'tok-123');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Saved');
  expect(lastPut).toMatchObject({
    provider: 'ollama',
    base_url: 'https://ollama.com/v1',
    api_key: 'tok-123',
  });
  await waitFor(() => expect(screen.getByLabelText('API key')).toHaveValue(''));
  expect(screen.getByLabelText('API key')).toHaveAttribute(
    'placeholder',
    expect.stringContaining('saved'),
  );
});

it('spells out what the thinking switch does in each state', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SettingsPage />);
  const toggle = await screen.findByRole('switch', { name: /Thinking mode: on/ });
  expect(screen.getByText(/streams live above the answer/)).toBeInTheDocument();
  await user.click(toggle);
  expect(screen.getByRole('switch', { name: /Thinking mode: off/ })).toBeInTheDocument();
  expect(screen.getByText(/never shown/)).toBeInTheDocument();
});

it('lets you choose how hard the model thinks, defaulting to High', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SettingsPage />);
  const effort = await screen.findByRole('radiogroup', { name: 'Thinking effort' });
  await waitFor(() => expect(within(effort).getByLabelText('High')).toBeChecked());
  expect(screen.getByTestId('effort-hint')).toHaveTextContent(/Thorough reasoning/);

  await user.click(within(effort).getByText('Low'));
  expect(screen.getByTestId('effort-hint')).toHaveTextContent(/Fastest/);
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Saved');
  expect(lastPut).toMatchObject({ thinking: true, thinking_effort: 'low' });
});

it('hides the effort choice when thinking is off', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SettingsPage />);
  await screen.findByRole('radiogroup', { name: 'Thinking effort' });
  await user.click(screen.getByRole('switch', { name: /Thinking mode/ }));
  expect(screen.queryByRole('radiogroup', { name: 'Thinking effort' })).not.toBeInTheDocument();
});

it('shows placeholders, not an empty form, until the saved settings arrive', async () => {
  renderWithProviders(<SettingsPage />);
  // First paint: nothing to edit yet, so no empty inputs that look broken.
  expect(screen.getByTestId('settings-skeleton')).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByLabelText('Model')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

  // Then the filled-in form replaces it.
  const model = await screen.findByLabelText('Model');
  expect(model).toHaveValue('gpt-oss:120b-cloud');
  expect(screen.queryByTestId('settings-skeleton')).not.toBeInTheDocument();
});

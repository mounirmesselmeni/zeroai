import {
  Alert,
  Button,
  Card,
  Divider,
  Skeleton,
  Grid,
  Group,
  PasswordInput,
  SegmentedControl,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { LLMConfigUpdateProvider } from '../api/generated/model';

type ThinkingEffort = 'low' | 'medium' | 'high';

const EFFORT_HINT: Record<ThinkingEffort, string> = {
  low: 'A sentence or two. Fastest.',
  medium: 'A short paragraph.',
  high: 'Thorough reasoning. Slowest, about 3x the time of Low.',
};
import {
  getGetLlmSettingsQueryKey,
  useGetLlmSettings,
  useUpdateLlmSettings,
} from '../api/generated/settings/settings';
import { useGetRecentRuns, useGetUsageByModel } from '../api/generated/usage/usage';
import { formatDuration, formatTokens } from '../lib';

const DEFAULTS: Record<LLMConfigUpdateProvider, { model: string; base_url: string }> = {
  ollama: { model: 'gpt-oss:120b-cloud', base_url: 'http://localhost:11434/v1' },
  openai: { model: 'gpt-4o-mini', base_url: '' },
};

function ModelSettings() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useGetLlmSettings();
  const [saved, setSaved] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const save = useUpdateLlmSettings({
    mutation: {
      onSuccess: () => {
        setSaved(true);
        setClearKey(false);
        form.setFieldValue('api_key', '');
        queryClient.invalidateQueries({ queryKey: getGetLlmSettingsQueryKey() });
      },
    },
  });

  const form = useForm<{
    provider: LLMConfigUpdateProvider;
    model: string;
    base_url: string;
    api_key: string;
    thinking: boolean;
    thinking_effort: ThinkingEffort;
  }>({
    initialValues: {
      provider: 'ollama',
      model: '',
      base_url: '',
      api_key: '',
      thinking: true,
      thinking_effort: 'high',
    },
    validate: {
      model: (v) => (v.trim() ? null : 'Model is required'),
      base_url: (v) =>
        !v || /^https?:\/\//i.test(v) ? null : 'Must start with http:// or https://',
    },
  });

  useEffect(() => {
    if (data) {
      form.setValues({
        provider: data.provider,
        model: data.model,
        base_url: data.base_url ?? '',
        api_key: '',
        thinking: data.thinking,
        thinking_effort: data.thinking_effort,
      });
      form.resetDirty();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const changeProvider = (provider: string) => {
    const next = provider as LLMConfigUpdateProvider;
    form.setValues({ provider: next, ...DEFAULTS[next] });
    setSaved(false);
  };

  const submit = form.onSubmit((v) => {
    setSaved(false);
    save.mutate({
      data: {
        provider: v.provider,
        model: v.model,
        base_url: v.base_url || null,
        thinking: v.thinking,
        thinking_effort: v.thinking_effort,
        // undefined keeps the stored key; '' removes it.
        api_key: clearKey ? '' : v.api_key || undefined,
      },
    });
  });

  const isOpenAI = form.values.provider === 'openai';

  if (isError && !data) {
    return (
      <Alert role="alert" title="Could not load model settings">
        <Stack gap="sm">
          <Text size="sm">Check that the server is running and try again.</Text>
          <Button onClick={() => void refetch()}>Retry</Button>
        </Stack>
      </Alert>
    );
  }

  // Until the saved settings arrive the inputs would be empty (or hold stale defaults), which
  // looks like a bug. Show placeholders instead of a form that is not filled in yet.
  if (isLoading || !data) {
    return (
      <Card
        padding="lg"
        aria-label="Loading model settings"
        aria-busy="true"
        data-testid="settings-skeleton"
      >
        <Stack gap="md">
          <Title order={4}>Model</Title>
          <Skeleton height={34} />
          {[0, 1, 2].map((i) => (
            <Stack key={i} gap={6}>
              <Skeleton height={12} width={90} />
              <Skeleton height={36} />
            </Stack>
          ))}
          <Skeleton height={36} width={96} />
        </Stack>
      </Card>
    );
  }

  return (
    <Card padding="lg">
      <form onSubmit={submit}>
        <Stack gap="sm">
          <Title order={4}>Model</Title>
          <Text size="sm" c="dimmed">
            Stored in the local database. Takes effect on the next summary.
          </Text>
          <SegmentedControl
            aria-label="Provider"
            value={form.values.provider}
            onChange={changeProvider}
            data={[
              { value: 'ollama', label: 'Ollama (local)' },
              { value: 'openai', label: 'OpenAI' },
            ]}
          />
          <TextInput label="Model" {...form.getInputProps('model')} />
          <TextInput
            label="Base URL"
            description={
              isOpenAI
                ? 'Optional. Leave empty for api.openai.com. Custom origins must be allow-listed by the server.'
                : 'Custom origins must be allow-listed by the server.'
            }
            placeholder={isOpenAI ? 'https://api.openai.com/v1' : DEFAULTS.ollama.base_url}
            {...form.getInputProps('base_url')}
          />
          <Stack gap={4}>
            <PasswordInput
              label="API key"
              description={
                isOpenAI
                  ? 'Required for OpenAI.'
                  : 'Optional. Only for an Ollama that needs a token, e.g. https://ollama.com/v1. A local Ollama needs none.'
              }
              placeholder={
                data?.api_key_set && !clearKey
                  ? '•••••••• saved, leave blank to keep'
                  : isOpenAI
                    ? 'sk-…'
                    : 'Leave empty for a local Ollama'
              }
              disabled={clearKey}
              {...form.getInputProps('api_key')}
            />
            {data?.api_key_set && (
              <Button
                variant="subtle"
                size="compact-xs"
                w="fit-content"
                onClick={() => setClearKey((c) => !c)}
              >
                {clearKey ? 'Keep the saved key' : 'Remove the saved key'}
              </Button>
            )}
          </Stack>
          {!isOpenAI && (
            <Stack gap="xs">
              <Divider label="Reasoning" labelPosition="left" mt="xs" />
              <Group justify="space-between" wrap="nowrap" gap="md" p="sm" className="setting-row">
                <Stack gap={2}>
                  <Text size="sm" fw={500}>
                    Thinking mode
                  </Text>
                  <Text size="xs" c="dimmed">
                    {form.values.thinking
                      ? "The model's reasoning streams live above the answer."
                      : 'Reasoning is not requested and never shown. Faster and more reliable.'}
                  </Text>
                </Stack>
                <Switch
                  size="md"
                  onLabel="ON"
                  offLabel="OFF"
                  aria-label={`Thinking mode: ${form.values.thinking ? 'on' : 'off'}`}
                  {...form.getInputProps('thinking', { type: 'checkbox' })}
                />
              </Group>
              {form.values.thinking && (
                <Stack gap={6} p="sm" className="setting-row">
                  <Group justify="space-between" wrap="nowrap" gap="md">
                    <Text size="sm" fw={500}>
                      Thinking effort
                    </Text>
                    <SegmentedControl
                      size="xs"
                      aria-label="Thinking effort"
                      data={[
                        { value: 'low', label: 'Low' },
                        { value: 'medium', label: 'Medium' },
                        { value: 'high', label: 'High' },
                      ]}
                      {...form.getInputProps('thinking_effort')}
                    />
                  </Group>
                  <Text size="xs" c="dimmed" data-testid="effort-hint">
                    {EFFORT_HINT[form.values.thinking_effort]} Honoured by gpt-oss; qwen3 only has
                    on or off.
                  </Text>
                </Stack>
              )}
              <Group
                gap={6}
                align="flex-start"
                wrap="nowrap"
                role="note"
                data-testid="thinking-note"
              >
                <IconAlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                <Text size="xs" c="dimmed">
                  Reasoning is slower, and local models like qwen3 sometimes think and return
                  nothing, which ends in a "no usable answer" error. If you see that, turn this off.
                  gpt-oss always reasons: when off it uses the lowest effort and hides it.
                </Text>
              </Group>
            </Stack>
          )}
          <Group>
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
            {saved && (
              <Group gap={4} role="status">
                <IconCheck size={16} />
                <Text size="sm">Saved</Text>
              </Group>
            )}
          </Group>
          {save.isError && (
            <Alert role="alert" title="Could not save">
              Check the values and try again.
            </Alert>
          )}
        </Stack>
      </form>
    </Card>
  );
}

function UsageStats() {
  const models = useGetUsageByModel();
  const recent = useGetRecentRuns({ limit: 10 });
  const perModel = models.data ?? [];
  const runs = recent.data ?? [];
  if (models.isError || recent.isError) {
    return (
      <Alert role="alert" title="Could not load token usage">
        <Button onClick={() => void Promise.all([models.refetch(), recent.refetch()])}>
          Retry
        </Button>
      </Alert>
    );
  }
  if (models.isLoading || recent.isLoading) {
    return <Skeleton height={120} aria-label="Loading token usage" />;
  }
  return (
    <Stack gap="md">
      <Title order={4}>Token usage</Title>
      {perModel.length === 0 ? (
        <Text size="sm" c="dimmed">
          No runs yet. Usage is recorded after each finished summary.
        </Text>
      ) : (
        <>
          <Card padding={0}>
            <Table.ScrollContainer minWidth={520}>
              <Table aria-label="Usage per model" verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Model</Table.Th>
                    <Table.Th ta="right">Runs</Table.Th>
                    <Table.Th ta="right">Input</Table.Th>
                    <Table.Th ta="right">Output</Table.Th>
                    <Table.Th ta="right">Total</Table.Th>
                    <Table.Th ta="right">Avg time</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {perModel.map((m) => (
                    <Table.Tr key={`${m.provider}/${m.model}`}>
                      <Table.Td>
                        <Text size="sm" fw={600}>
                          {m.model}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {m.provider}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">{m.runs}</Table.Td>
                      <Table.Td ta="right">{formatTokens(m.input_tokens)}</Table.Td>
                      <Table.Td ta="right">{formatTokens(m.output_tokens)}</Table.Td>
                      <Table.Td ta="right">{formatTokens(m.total_tokens)}</Table.Td>
                      <Table.Td ta="right">{formatDuration(m.avg_duration_ms)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
          <Title order={5}>Recent runs</Title>
          <Card padding={0}>
            <Table.ScrollContainer minWidth={420}>
              <Table aria-label="Recent runs" verticalSpacing="xs">
                <Table.Tbody>
                  {runs.map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td fw={600}>{r.ticker}</Table.Td>
                      <Table.Td c="dimmed">{r.model}</Table.Td>
                      <Table.Td ta="right">{formatTokens(r.total_tokens)} tokens</Table.Td>
                      <Table.Td ta="right">{formatDuration(r.duration_ms)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
        </>
      )}
    </Stack>
  );
}

export function SettingsPage() {
  return (
    <Stack gap="xl">
      <Stack gap={4}>
        <Title order={1} className="display" fz={{ base: 36, sm: 46 }}>
          Settings
        </Title>
        <Text c="dimmed">Choose the model that writes your briefings and see what it costs.</Text>
      </Stack>
      <Grid gap="xl">
        <Grid.Col span={{ base: 12, md: 5 }}>
          <ModelSettings />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <UsageStats />
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

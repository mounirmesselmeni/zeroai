import {
  Alert,
  ActionIcon,
  Button,
  Card,
  Code,
  Grid,
  Group,
  Skeleton,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  IconCheck,
  IconPlayerPlay,
  IconPlus,
  IconRss,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { InfoBadge } from '../components/InfoBadge';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FeedCheck } from '../api/generated/model';
import {
  getListSourcesQueryKey,
  useCheckSource,
  useCreateSource,
  useDeleteSource,
  useListSources,
  useUpdateSource,
} from '../api/generated/sources/sources';

/** One-line outcome of "Test feed": what it is and how many items, or why it failed. */
function CheckResult({ result, id }: { result: FeedCheck; id: string }) {
  return (
    <Group gap={6} align="flex-start" wrap="nowrap" role="status" data-testid={`check-${id}`}>
      {result.ok ? (
        <IconCheck size={14} style={{ flexShrink: 0, marginTop: 2 }} />
      ) : (
        <IconX size={14} style={{ flexShrink: 0, marginTop: 2 }} />
      )}
      <Text size="xs" c="dimmed">
        {result.ok
          ? `${result.kind?.toUpperCase()} feed, ${result.item_count} items. For example: "${result.sample?.[0] ?? ''}"`
          : `Does not work: ${result.error}`}
      </Text>
    </Group>
  );
}

export function SourcesPage() {
  const queryClient = useQueryClient();
  const { data: sources = [], isLoading, isError, refetch } = useListSources();
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListSourcesQueryKey() });
  const create = useCreateSource({ mutation: { onSuccess: refresh } });
  const update = useUpdateSource({ mutation: { onSuccess: refresh } });
  const remove = useDeleteSource({ mutation: { onSuccess: refresh } });
  const check = useCheckSource();
  // Results of "Test feed", keyed by source id or "form".
  const [checks, setChecks] = useState<Record<string, FeedCheck>>({});
  const runCheck = (key: string, urlTemplate: string) =>
    check.mutate(
      { data: { url_template: urlTemplate } },
      {
        onSuccess: (result) => setChecks((c) => ({ ...c, [key]: result })),
        onError: () =>
          setChecks((c) => ({ ...c, [key]: { ok: false, error: 'the check itself failed' } })),
      },
    );

  const form = useForm({
    initialValues: { name: '', url_template: '' },
    validate: {
      name: (v) => (v.trim() ? null : 'Name is required'),
      url_template: (v) => (/^https?:\/\//i.test(v) ? null : 'Must start with http:// or https://'),
    },
  });

  const submit = form.onSubmit((values) =>
    create.mutate({ data: values }, { onSuccess: () => form.reset() }),
  );

  return (
    <Stack gap="xl">
      <Stack gap={4}>
        <Title order={1} className="display" fz={{ base: 36, sm: 46 }}>
          News sources
        </Title>
        <Text c="dimmed">
          RSS or Atom feeds fetched for each lookup. Use <Code>{'{ticker}'}</Code> where the stock
          symbol goes. The server only fetches hosts in its feed allow-list.
        </Text>
      </Stack>

      <Grid gap="xl">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack gap="sm">
            {isError && (
              <Alert role="alert" title="Could not load sources">
                <Button onClick={() => void refetch()}>Retry</Button>
              </Alert>
            )}
            {(update.isError || remove.isError) && (
              <Alert role="alert" title="Could not update sources">
                The change was not saved. Try again.
              </Alert>
            )}
            {isLoading &&
              [0, 1, 2].map((i) => <Skeleton key={i} height={76} radius="lg" aria-hidden />)}
            {sources.map((s) => (
              <Card key={s.id} padding="md" className="card-lift">
                <Group justify="space-between" wrap="nowrap" gap="sm">
                  <Group wrap="nowrap" gap="sm" style={{ minWidth: 0 }}>
                    <IconRss size={20} />
                    <Stack gap={2} style={{ minWidth: 0 }}>
                      <Group gap="xs">
                        <Text fw={600}>{s.name}</Text>
                        {!s.enabled && (
                          <InfoBadge
                            size="xs"
                            tip="Disabled: this feed is skipped when fetching news. Switch it on to use it again."
                          >
                            off
                          </InfoBadge>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed" truncate>
                        {s.url_template}
                      </Text>
                    </Stack>
                  </Group>
                  <Group wrap="nowrap" gap="xs">
                    <ActionIcon
                      color="gray"
                      variant="subtle"
                      radius="md"
                      aria-label={`Test ${s.name}`}
                      title="Test this feed"
                      onClick={() => runCheck(String(s.id), s.url_template)}
                    >
                      <IconPlayerPlay size={18} />
                    </ActionIcon>
                    <Switch
                      aria-label={`Enable ${s.name}`}
                      checked={s.enabled}
                      onChange={(e) =>
                        update.mutate({
                          sourceId: s.id,
                          data: { enabled: e.currentTarget.checked },
                        })
                      }
                    />
                    <ActionIcon
                      color="gray"
                      variant="subtle"
                      radius="md"
                      aria-label={`Delete ${s.name}`}
                      onClick={() => remove.mutate({ sourceId: s.id })}
                    >
                      <IconTrash size={18} />
                    </ActionIcon>
                  </Group>
                </Group>
                {checks[String(s.id)] && (
                  <CheckResult result={checks[String(s.id)]} id={String(s.id)} />
                )}
              </Card>
            ))}
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card padding="lg" shadow="sm">
            <form onSubmit={submit}>
              <Stack gap="sm">
                <Title order={4}>Add a source</Title>
                <TextInput label="Name" {...form.getInputProps('name')} />
                <TextInput
                  label="Feed URL"
                  placeholder="https://example.com/rss?symbol={ticker}"
                  {...form.getInputProps('url_template')}
                />
                <Group gap="xs">
                  <Button
                    type="submit"
                    loading={create.isPending}
                    leftSection={<IconPlus size={16} />}
                  >
                    Add source
                  </Button>
                  <Button
                    variant="default"
                    leftSection={<IconPlayerPlay size={16} />}
                    loading={check.isPending}
                    disabled={!/^https?:\/\//i.test(form.values.url_template)}
                    onClick={() => runCheck('form', form.values.url_template)}
                  >
                    Test feed
                  </Button>
                </Group>
                {create.isError && (
                  <Alert role="alert" title="Could not add source">
                    Check the URL and confirm its host is allowed by the server configuration.
                  </Alert>
                )}
                {checks.form && <CheckResult result={checks.form} id="form" />}
              </Stack>
            </form>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

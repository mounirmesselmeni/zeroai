import { Alert, Anchor, Card, Group, Stack, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconExternalLink } from '@tabler/icons-react';
import type { NewsResponse } from '../api/generated/model';
import { InfoBadge } from './InfoBadge';

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function NewsList({ news }: { news: NewsResponse }) {
  return (
    <Stack gap="sm" aria-label="Source articles">
      <Group justify="space-between">
        <Title order={4}>Sources ({news.items.length})</Title>
      </Group>
      {!!news.errors?.length && (
        <Alert icon={<IconAlertCircle size={16} />} p="xs">
          <Text size="sm">Some sources failed: {news.errors?.join(', ')}</Text>
        </Alert>
      )}
      {news.items.map((item) => (
        <Card key={item.link} padding="md" className="card-lift">
          <Anchor
            href={item.link}
            target="_blank"
            rel="noreferrer noopener"
            fw={600}
            size="sm"
            lh={1.4}
            c="inherit"
            underline="hover"
          >
            {item.title}{' '}
            <IconExternalLink size={12} style={{ verticalAlign: 'middle', opacity: 0.6 }} />
          </Anchor>
          <Group gap="xs" mt={8}>
            <InfoBadge
              size="sm"
              tip={`This headline came from the "${item.source}" feed. Add, disable or test feeds on the Sources page.`}
            >
              {item.source}
            </InfoBadge>
            {item.published && (
              <Text size="xs" c="dimmed" title={new Date(item.published).toLocaleString()}>
                {timeAgo(item.published)}
              </Text>
            )}
          </Group>
        </Card>
      ))}
    </Stack>
  );
}

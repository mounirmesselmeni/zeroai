import { Card, Group, Skeleton, Stack, Title } from '@mantine/core';

/** Placeholder article cards shown while the news sources are being fetched. */
export function NewsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <Stack gap="sm" aria-label="Loading sources" aria-busy="true" data-testid="news-skeleton">
      <Title order={4}>Sources</Title>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} padding="md" aria-hidden>
          <Skeleton height={14} width={i % 2 ? '85%' : '95%'} />
          <Skeleton height={14} width="60%" mt={8} />
          <Group gap="xs" mt={12}>
            <Skeleton height={20} width={96} />
            <Skeleton height={12} width={56} />
          </Group>
        </Card>
      ))}
    </Stack>
  );
}

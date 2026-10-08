import {
  Box,
  Card,
  Group,
  List,
  Paper,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowsShuffle,
  IconCheck,
  IconClock,
  IconCoins,
  IconMinus,
  IconTelescope,
  IconTrendingDown,
  IconTrendingUp,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import type { StockSummary } from '../api/generated/model';
import type { RunStats } from '../hooks/useSummaryStream';
import { formatDuration, formatTokens } from '../lib';
import { useThemeMode } from '../theme/ThemeMode';
import { AsciiBar } from './Ascii';
import { InfoBadge } from './InfoBadge';

// Monochrome: sentiment is conveyed by icon + label, not colour.
const SENTIMENT_TIP: Record<string, string> = {
  bullish:
    'Bullish: the news leans positive for this stock, such as strong results, growth or good deals. Prices are more likely to be talked up than down.',
  bearish:
    'Bearish: the news leans negative, such as weak results, lawsuits or a downgrade. Prices are more likely to be talked down than up.',
  neutral: 'Neutral: the news is routine or balanced and points in no clear direction.',
  mixed:
    'Mixed: there is significant good and bad news at the same time, so the signals pull in opposite directions.',
};

const SENTIMENT: Record<string, ReactNode> = {
  bullish: <IconTrendingUp size={14} />,
  bearish: <IconTrendingDown size={14} />,
  neutral: <IconMinus size={14} />,
  mixed: <IconArrowsShuffle size={14} />,
};

interface Props {
  ticker: string;
  summary: Partial<StockSummary> | null;
  streaming: boolean;
  usage?: RunStats | null;
}

export function SummaryCard({ ticker, summary, streaming, usage }: Props) {
  const terminal = useThemeMode().mode === 'terminal';
  const sentiment = summary?.sentiment ? SENTIMENT[summary.sentiment] : undefined;
  return (
    <Card
      padding="xl"
      data-sentiment={summary?.sentiment}
      aria-label="AI summary"
      aria-busy={streaming}
    >
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={2}>
            <Text size="xs" tt="uppercase" fw={700} c="dimmed" lts={1}>
              {terminal ? `+--- AI BRIEFING ---+` : 'AI briefing'}
            </Text>
            <Title order={2}>{ticker}</Title>
          </Stack>
          {sentiment && summary?.sentiment && (
            <InfoBadge
              size="lg"
              leftSection={sentiment}
              data-testid="sentiment"
              tip={`${SENTIMENT_TIP[summary.sentiment]} The AI judged this from the headlines only; it is not a prediction.`}
            >
              {summary.sentiment}
            </InfoBadge>
          )}
        </Group>

        {summary?.headline ? (
          <Text fw={600} fz={{ base: 'lg', sm: 'xl' }} lh={1.35}>
            {summary.headline}
          </Text>
        ) : (
          streaming && (
            <Stack gap={8}>
              <Skeleton height={22} />
              <Skeleton height={22} width="70%" />
            </Stack>
          )
        )}

        {!!summary?.key_points?.length && (
          <List
            spacing="sm"
            aria-label="Key points"
            icon={
              <ThemeIcon size={20} radius="xl" variant="default">
                <IconCheck size={12} />
              </ThemeIcon>
            }
          >
            {summary.key_points.map((p, i) => (
              <List.Item key={i}>{p}</List.Item>
            ))}
          </List>
        )}

        {!!summary?.risks?.length && (
          <Paper p="md" className="muted-panel">
            <Group gap="xs" mb="xs">
              <IconAlertTriangle size={16} />
              <Text fw={600} size="sm" className="risk-title">
                Risks
              </Text>
            </Group>
            <List spacing="xs" size="sm" aria-label="Risks">
              {summary.risks.map((r, i) => (
                <List.Item key={i}>{r}</List.Item>
              ))}
            </List>
          </Paper>
        )}

        {summary?.outlook && (
          <Paper p="md" className="muted-panel">
            <Group gap="xs" mb={4}>
              <IconTelescope size={16} />
              <Text fw={600} size="sm">
                Outlook
              </Text>
            </Group>
            <Text size="sm">{summary.outlook}</Text>
          </Paper>
        )}

        {usage && terminal && (
          <div data-testid="token-bars">
            <AsciiBar
              label="IN "
              value={usage.input_tokens / Math.max(usage.input_tokens, usage.output_tokens, 1)}
              suffix={formatTokens(usage.input_tokens)}
            />
            <AsciiBar
              label="OUT"
              value={usage.output_tokens / Math.max(usage.input_tokens, usage.output_tokens, 1)}
              suffix={formatTokens(usage.output_tokens)}
            />
          </div>
        )}
        {usage && (
          <Group gap="xs" data-testid="run-stats" aria-label="Run statistics">
            <InfoBadge
              size="md"
              leftSection={<IconClock size={12} />}
              tip="Total time from pressing Summarise to the finished answer. It includes fetching the news, any waiting for the model, and the model's reasoning."
            >
              {formatDuration(usage.duration_ms)}
            </InfoBadge>
            <InfoBadge
              size="md"
              leftSection={<IconCoins size={12} />}
              tip={`Tokens are the pieces of text a model reads and writes. Input ${formatTokens(usage.input_tokens)} (the headlines and instructions) + output ${formatTokens(usage.output_tokens)} (its reasoning and answer) = ${formatTokens(usage.total_tokens)}. Model calls made: ${usage.requests}${usage.requests > 1 ? ' (it had to retry)' : ''}.`}
            >
              {formatTokens(usage.total_tokens)} tokens
            </InfoBadge>
            <Text size="xs" c="dimmed">
              {formatTokens(usage.input_tokens)} in · {formatTokens(usage.output_tokens)} out ·{' '}
              {usage.model}
            </Text>
          </Group>
        )}
        <Box>
          <Text size="xs" c="dimmed">
            AI-generated from the headlines alongside. Not investment advice.
          </Text>
        </Box>
      </Stack>
    </Card>
  );
}

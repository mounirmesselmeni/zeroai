import {
  Alert,
  Box,
  Button,
  Grid,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { IconAlertCircle, IconSearch } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { NewsList } from '../components/NewsList';
import { NewsSkeleton } from '../components/NewsSkeleton';
import { SummaryCard } from '../components/SummaryCard';
import { BrailleSpinner } from '../components/BrailleSpinner';
import { ThinkingPanel } from '../components/ThinkingPanel';
import { useTypewriter } from '../components/Typewriter';
import { useElapsed } from '../hooks/useElapsed';
import { useThemeMode } from '../theme/ThemeMode';
import { useSummaryStream } from '../hooks/useSummaryStream';
import { formatDuration } from '../lib';

const POPULAR = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL'];

export function SummaryPage() {
  const [input, setInput] = useState('');
  const [ticker, setTicker] = useState('');
  const { state, start, cancel } = useSummaryStream();
  const terminal = useThemeMode().mode === 'terminal';
  const typed = useTypewriter("> TODAY'S NEWS, IN ONE BRIEFING", { enabled: terminal });
  const busy = state.phase === 'fetching' || state.phase === 'summarising';
  const elapsed = useElapsed(state.startedAt, busy);
  const thinkingNow = state.phase === 'summarising' && !state.summary;
  // The results grid appears as soon as a run starts, with skeletons where content will land.
  const hasResults = busy || !!state.summary || !!state.thinking || !!state.news;
  const newsLoading = busy && !state.news;

  const run = (raw: string) => {
    const symbol = raw.trim().toUpperCase();
    if (!symbol) return;
    setInput(symbol);
    setTicker(symbol);
    start(symbol);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(input);
  };

  return (
    <Stack gap="xl">
      <Box className="hero">
        <Stack gap="md" pos="relative" style={{ zIndex: 1 }}>
          <Stack gap="xs">
            {terminal ? (
              <Title order={1} className="display" aria-label="Today's news, in one briefing">
                {typed}
                <span className="cursor">█</span>
              </Title>
            ) : (
              <Title order={1} className="display" fz={{ base: 40, sm: 58 }}>
                Today’s news, <em>in one briefing.</em>
              </Title>
            )}
            <Text c="dimmed" maw={560}>
              Enter a ticker. We read the latest headlines from your sources and write the summary
              live.
            </Text>
          </Stack>
          <form onSubmit={submit}>
            <Group align="flex-end" gap="sm" wrap="nowrap">
              <TextInput
                label="Ticker"
                autoFocus
                placeholder="e.g. AAPL"
                size="lg"
                value={input}
                onChange={(e) => setInput(e.currentTarget.value)}
                maxLength={10}
                leftSection={
                  terminal ? (
                    <Text component="span" ff="monospace" fw={700} data-testid="prompt">
                      $
                    </Text>
                  ) : (
                    <IconSearch size={18} />
                  )
                }
                autoCapitalize="characters"
                autoComplete="off"
                style={{ flex: 1, maxWidth: 360 }}
              />
              <Button
                type="submit"
                size="lg"
                disabled={!input.trim() || busy}
                title={busy ? 'Summarising…' : !input.trim() ? 'Enter a ticker first' : undefined}
              >
                Summarise
              </Button>
            </Group>
          </form>
          <Group gap={8} aria-label="Suggestions">
            <Text size="xs" c="dimmed">
              Try:
            </Text>
            {POPULAR.map((symbol) => (
              <UnstyledButton
                key={symbol}
                className="chip"
                px="sm"
                py={4}
                fz="xs"
                fw={600}
                style={{ borderRadius: 'var(--mantine-radius-md)' }}
                disabled={busy}
                onClick={() => run(symbol)}
              >
                {symbol}
              </UnstyledButton>
            ))}
          </Group>
        </Stack>
      </Box>

      {busy && (
        <Stack gap={6} role="status">
          <Group gap="xs" ff="monospace">
            <BrailleSpinner />
            <Text size="sm" c="dimmed" ff="monospace">
              {state.status}…
            </Text>
            <Text size="sm" c="dimmed" ff="monospace" data-testid="elapsed">
              {formatDuration(elapsed)}
            </Text>
            <Button variant="default" size="compact-xs" onClick={cancel}>
              Stop
            </Button>
          </Group>
        </Stack>
      )}

      {state.phase === 'stopped' && (
        <Text size="sm" c="dimmed" role="status">
          Stopped. The model was released.
        </Text>
      )}

      {terminal && state.phase === 'done' && state.usage && (
        <Text size="sm" role="status" data-testid="status-ok">
          [OK] briefing complete in {formatDuration(state.usage.duration_ms)}
        </Text>
      )}

      {state.error && (
        <Alert
          icon={<IconAlertCircle size={18} />}
          title={terminal ? '[ERR] Something went wrong' : 'Something went wrong'}
          role="alert"
        >
          {state.error}
        </Alert>
      )}

      {hasResults && (
        <Grid gap="xl">
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Stack gap="md">
              {state.thinking && <ThinkingPanel text={state.thinking} streaming={thinkingNow} />}
              {(state.summary || busy) && (
                <SummaryCard
                  ticker={ticker}
                  summary={state.summary}
                  streaming={busy}
                  usage={state.usage}
                />
              )}
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            {newsLoading && <NewsSkeleton />}
            {state.news && <NewsList news={state.news} />}
          </Grid.Col>
        </Grid>
      )}
    </Stack>
  );
}

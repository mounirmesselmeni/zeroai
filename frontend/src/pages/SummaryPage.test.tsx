import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource } from '../test/fakes';
import { renderWithProviders } from '../test/render';
import { SummaryPage } from './SummaryPage';

beforeEach(() => {
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => vi.unstubAllGlobals());

it('shows per-feed errors even when every feed failed', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SummaryPage />);
  await user.type(screen.getByLabelText('Ticker'), 'aapl{enter}');
  act(() =>
    FakeEventSource.last.emit('news', { ticker: 'AAPL', items: [], errors: ['Yahoo: timed out'] }),
  );
  act(() => FakeEventSource.last.emit('error', { message: 'No recent news found for AAPL.' }));
  expect(screen.getByText(/Some sources failed: Yahoo: timed out/)).toBeInTheDocument();
});

it('streams a briefing into the page', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SummaryPage />);
  const button = screen.getByRole('button', { name: 'Summarise' });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('title', 'Enter a ticker first');

  await user.type(screen.getByLabelText('Ticker'), 'aapl');
  await user.click(button);
  const es = FakeEventSource.last;
  expect(es.url).toContain('/AAPL/');

  act(() => es.emit('status', { message: 'Fetching news for AAPL' }));
  expect(screen.getByRole('status')).toHaveTextContent('Fetching news for AAPL');

  act(() =>
    es.emit('news', {
      ticker: 'AAPL',
      errors: ['Nasdaq: HTTPStatusError'],
      items: [
        {
          title: 'Apple ships thing',
          link: 'https://x.test/1',
          source: 'Yahoo',
          published: '2026-10-06T10:00:00Z',
          snippet: '',
        },
        { title: 'Undated', link: 'https://x.test/2', source: 'Google', snippet: '' },
      ],
    }),
  );
  act(() => es.emit('status', { message: 'Summarising' }));
  expect(screen.getByLabelText('AI summary')).toHaveAttribute('aria-busy', 'true');

  act(() => es.emit('summary', { headline: 'Apple is' }));
  act(() =>
    es.emit('done', {
      summary: {
        headline: 'Apple is doing well',
        sentiment: 'bullish',
        key_points: ['Strong sales'],
        risks: ['Tariffs'],
        outlook: 'Watch Q4.',
      },
      usage: {
        provider: 'ollama',
        model: 'qwen3:latest',
        input_tokens: 1000,
        output_tokens: 234,
        total_tokens: 1234,
        requests: 1,
        duration_ms: 4249,
      },
    }),
  );

  expect(screen.getByText('Apple is doing well')).toBeInTheDocument();
  expect(screen.getByTestId('sentiment')).toHaveTextContent('bullish');
  expect(screen.getByLabelText('Key points')).toHaveTextContent('Strong sales');
  expect(screen.getByLabelText('Risks')).toHaveTextContent('Tariffs');
  expect(screen.getByText(/Watch Q4/)).toBeInTheDocument();
  expect(screen.getByText(/Some sources failed: Nasdaq/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Apple ships thing' })).toHaveAttribute(
    'href',
    'https://x.test/1',
  );
  expect(button).toBeEnabled();

  const stats = screen.getByTestId('run-stats');
  expect(stats).toHaveTextContent('4.2 s');
  expect(stats).toHaveTextContent('1,234 tokens');
  expect(stats).toHaveTextContent('1,000 in · 234 out · qwen3:latest');
});

it('streams the reasoning, then collapses it when the summary starts', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SummaryPage />);
  await user.type(screen.getByLabelText('Ticker'), 'msft{enter}');
  const es = FakeEventSource.last;
  act(() => es.emit('news', { ticker: 'MSFT', errors: [], items: [] }));
  act(() => es.emit('status', { message: 'Summarising' }));
  act(() => es.emit('thinking', { delta: 'Weighing the ' }));
  act(() => es.emit('thinking', { delta: 'headlines.' }));

  const toggle = screen.getByRole('button', { name: /Thinking/ });
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByTestId('thinking-text')).toHaveTextContent('Weighing the headlines.');
  expect(screen.getByRole('status')).toHaveTextContent('Summarising…');
  expect(screen.getByTestId('elapsed')).toBeInTheDocument();

  act(() => es.emit('summary', { headline: 'MSFT steady' }));
  const collapsed = screen.getByRole('button', { name: /Reasoning/ });
  expect(collapsed).toHaveAttribute('aria-expanded', 'false');
  await user.click(collapsed);
  expect(collapsed).toHaveAttribute('aria-expanded', 'true');
});

it('shows errors from the stream', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SummaryPage />);
  await user.type(screen.getByLabelText('Ticker'), 'zzzz{enter}');
  act(() => FakeEventSource.last.emit('error', { message: 'No recent news found for ZZZZ.' }));
  expect(screen.getByRole('alert')).toHaveTextContent('No recent news found for ZZZZ.');
});

it('ignores a blank submit', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SummaryPage />);
  await user.type(screen.getByLabelText('Ticker'), '   {enter}');
  expect(FakeEventSource.instances).toHaveLength(0);
});

it('starts a lookup from a popular-ticker chip', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SummaryPage />);
  await user.click(screen.getByRole('button', { name: 'NVDA' }));
  expect(FakeEventSource.last.url).toContain('/NVDA/');
  expect(screen.getByLabelText('Ticker')).toHaveValue('NVDA');
});

it('Stop closes the stream, frees the form, and says so', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SummaryPage />);
  await user.type(screen.getByLabelText('Ticker'), 'tsla{enter}');
  const es = FakeEventSource.last;
  act(() => es.emit('status', { message: 'Summarising' }));
  await user.click(screen.getByRole('button', { name: 'Stop' }));
  expect(es.closed).toBe(true);
  expect(screen.getByRole('status')).toHaveTextContent('Stopped');
  expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Summarise' })).toBeEnabled();
});

const usage = {
  provider: 'ollama',
  model: 'gpt-oss:120b-cloud',
  input_tokens: 1000,
  output_tokens: 250,
  total_tokens: 1250,
  requests: 1,
  duration_ms: 4249,
};

describe('terminal theme', () => {
  it('shows a shell prompt and a typed headline, with no logo (the header has the wordmark)', () => {
    vi.useFakeTimers();
    renderWithProviders(<SummaryPage />, { mode: 'terminal' });
    expect(screen.queryByRole('img', { name: 'ZeroAI' })).not.toBeInTheDocument();
    expect(screen.getByTestId('prompt')).toHaveTextContent('$');
    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveTextContent(/^█?$/); // nothing typed yet, only the cursor
    act(() => vi.advanceTimersByTime(60 * 40));
    expect(title).toHaveTextContent("> TODAY'S NEWS, IN ONE BRIEFING█");
    vi.useRealTimers();
  });

  it('keeps the classic hero (serif headline) in the classic theme', () => {
    renderWithProviders(<SummaryPage />);
    expect(screen.queryByTestId('prompt')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Today’s news, in one briefing.',
    );
  });

  it('reports [OK] with the time, and draws token bars', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SummaryPage />, { mode: 'terminal' });
    await user.type(screen.getByLabelText('Ticker'), 'aapl{enter}');
    const es = FakeEventSource.last;
    act(() => es.emit('status', { message: 'Summarising' }));
    expect(screen.getByTestId('spinner')).toHaveTextContent(/^[|/\\-]$/);
    expect(screen.queryByTestId('status-ok')).not.toBeInTheDocument();
    act(() =>
      es.emit('done', {
        summary: { headline: 'h', sentiment: 'bullish', key_points: [], risks: [], outlook: 'o' },
        usage,
      }),
    );
    expect(screen.getByTestId('status-ok')).toHaveTextContent('[OK] briefing complete in 4.2 s');
    expect(screen.getByTestId('bar-IN').textContent).toBe('IN  [||||||||||||||||||||] 1,000');
    expect(screen.getByTestId('bar-OUT').textContent).toBe('OUT [|||||...............] 250');
  });

  it('prefixes errors with [ERR]', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SummaryPage />, { mode: 'terminal' });
    await user.type(screen.getByLabelText('Ticker'), 'zz{enter}');
    act(() => FakeEventSource.last.emit('error', { message: 'No recent news found for ZZ.' }));
    expect(screen.getByRole('alert')).toHaveTextContent('[ERR] Something went wrong');
  });

  it('shows no token bars or [OK] line in the classic theme', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SummaryPage />);
    await user.type(screen.getByLabelText('Ticker'), 'aapl{enter}');
    act(() =>
      FakeEventSource.last.emit('done', {
        summary: { headline: 'h', sentiment: 'bullish', key_points: [], risks: [], outlook: 'o' },
        usage,
      }),
    );
    expect(screen.queryByTestId('status-ok')).not.toBeInTheDocument();
    expect(screen.queryByTestId('token-bars')).not.toBeInTheDocument();
    expect(screen.getByTestId('run-stats')).toBeInTheDocument();
  });
});

describe('loading skeletons', () => {
  it('shows placeholder article cards while the sources are being fetched, then the real ones', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SummaryPage />);
    expect(screen.queryByTestId('news-skeleton')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Ticker'), 'aapl{enter}');
    const skeleton = screen.getByTestId('news-skeleton');
    expect(skeleton).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText('Loading sources')).toBeInTheDocument();
    // the briefing column has its own placeholder at the same time
    expect(screen.getByLabelText('AI summary')).toHaveAttribute('aria-busy', 'true');

    act(() =>
      FakeEventSource.last.emit('news', {
        ticker: 'AAPL',
        errors: [],
        items: [{ title: 'Real headline', link: 'https://x.test/1', source: 'Yahoo', snippet: '' }],
      }),
    );
    expect(screen.queryByTestId('news-skeleton')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Real headline/ })).toBeInTheDocument();
  });

  it('drops the skeleton when the run fails before any news arrives', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SummaryPage />);
    await user.type(screen.getByLabelText('Ticker'), 'zz{enter}');
    expect(screen.getByTestId('news-skeleton')).toBeInTheDocument();
    act(() => FakeEventSource.last.emit('error', { message: 'No recent news found for ZZ.' }));
    expect(screen.queryByTestId('news-skeleton')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('drops the skeleton when the user presses Stop', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SummaryPage />);
    await user.type(screen.getByLabelText('Ticker'), 'tsla{enter}');
    expect(screen.getByTestId('news-skeleton')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.queryByTestId('news-skeleton')).not.toBeInTheDocument();
  });
});

it.each(['classic', 'terminal'] as const)(
  'the ticker box starts empty in the %s theme, with Summarise unavailable',
  (mode) => {
    renderWithProviders(<SummaryPage />, { mode });
    expect(screen.getByLabelText('Ticker')).toHaveValue('');
    expect(screen.getByRole('button', { name: /Summarise/i })).toBeDisabled();
  },
);

it.each(['classic', 'terminal'] as const)(
  'focuses the ticker box as soon as the page has loaded (%s theme)',
  (mode) => {
    renderWithProviders(<SummaryPage />, { mode });
    expect(screen.getByLabelText('Ticker')).toHaveFocus();
  },
);

it('lets you type straight away, with no click needed', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SummaryPage />);
  await user.keyboard('msft');
  expect(screen.getByLabelText('Ticker')).toHaveValue('msft');
  await user.keyboard('{Enter}');
  expect(FakeEventSource.last.url).toContain('/MSFT/');
});

it('does not remember a ticker between visits', async () => {
  const user = userEvent.setup();
  const first = renderWithProviders(<SummaryPage />);
  await user.type(screen.getByLabelText('Ticker'), 'nvda{enter}');
  expect(localStorage.getItem('zeroai-ui') ?? '').not.toContain('NVDA');
  first.unmount();

  renderWithProviders(<SummaryPage />);
  expect(screen.getByLabelText('Ticker')).toHaveValue('');
});

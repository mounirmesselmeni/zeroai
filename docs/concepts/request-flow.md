# Request flow

What happens, step by step, when you press **Summarise**.

## The happy path

```mermaid
sequenceDiagram
    autonumber
    actor U as You
    participant W as Web app
    participant A as FastAPI
    participant F as News feeds
    participant G as LLM gate
    participant M as Model
    participant D as SQLite

    U->>W: AAPL, Summarise
    W->>A: GET /stocks/AAPL/summary/stream (EventSource)
    A->>D: enabled news sources
    A-->>W: event status "Fetching news"
    par every enabled source, concurrently
        A->>F: GET feed (8 s timeout)
    end
    F-->>A: items (failed sources reported, not fatal)
    A-->>W: event news (merged, de-duplicated, newest first)
    A->>G: acquire (waits if busy)
    A-->>W: event status "Summarising"
    A->>D: read model config (provider, model, key, thinking)
    A->>M: prompt = headlines + instructions
    loop while the model streams
        M-->>A: reasoning tokens
        A-->>W: event thinking (only if Thinking mode is on)
        M-->>A: structured-output fragments
        A-->>W: event summary (partial JSON parsed so far)
    end
    M-->>A: final output + token usage
    A->>G: release
    A->>D: store run (tokens, duration)
    A-->>W: event done {summary, usage}
    W-->>U: briefing, time, tokens
```

## When the model needs another attempt

Small and reasoning models sometimes answer with nothing, or with broken JSON. PydanticAI tells the
model what was wrong and asks again, up to **3** times (`OUTPUT_RETRIES`).

```mermaid
flowchart TD
    S([Model attempt]) --> V{Usable structured answer?}
    V -->|yes| OK([done event])
    V -->|"no: empty reply,<br/>invalid JSON, bad field"| R{Retries left?}
    R -->|yes| N["Feed the problem back,<br/>start a fresh tool call<br/>(partial buffer is reset)"] --> S
    R -->|no| E(["error event:<br/>'model did not return a usable answer'"])
```

The `usage.requests` value in the `done` event is how many attempts it took (1 means first try).

## When you close the tab

```mermaid
sequenceDiagram
    participant W as Browser
    participant A as FastAPI
    participant G as LLM gate
    participant M as Model

    W->>A: stream open, model working
    Note over W: reload, navigate away or press Stop
    W--xA: connection closed
    A->>A: Starlette cancels the response task
    A->>M: model request dropped
    A->>G: release (finally)
    Note over A: logs client_disconnected<br/>nothing is recorded in usage
```

The next request starts immediately, with no "Waiting for the model".

## When requests queue

With the default concurrency of 1, two people (or two tabs) never hit the model at once.

```mermaid
sequenceDiagram
    participant A as Request A
    participant B as Request B
    participant G as LLM gate (1 slot)
    participant M as Model

    A->>G: acquire
    G-->>A: granted
    A->>M: run
    B->>G: acquire
    Note over B: UI shows "Waiting for the model"
    M-->>A: done
    A->>G: release
    G-->>B: granted
    B->>M: run
```

## Errors you can see

| Situation | Event | What you see |
| --- | --- | --- |
| No feed returned anything | `error` | "No recent news found for XYZ." |
| Some feeds failed | `news` with `errors` | Briefing works, with a "Some sources failed" notice |
| Model returned nothing usable | `error` | "model did not return a usable answer ... try again or pick a different model" |
| Model/provider failure | `error` | "Summary failed: ..." |
| OpenAI selected, no key | HTTP 503 before streaming | "Add an OpenAI API key on the Settings page." |
| Connection lost | (client side) | "Connection to the server was lost." |

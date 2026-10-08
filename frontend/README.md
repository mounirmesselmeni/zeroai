# ZeroAI frontend

Vite + React 19 + Mantine + TanStack Router/Query. See the [root README](../README.md).

```bash
yarn install
yarn dev            # http://localhost:5173, proxies /api to :8000
yarn api:generate   # Orval client from src/api/openapi.json
yarn test           # vitest, fails under 90% coverage
yarn e2e            # Playwright (Vite :5273 with Orval-generated MSW handlers; no API server)
```

Vite proxies `/api` to `http://localhost:8000` by default for local development. Playwright enables
MSW in its Vite process and does not start or require an API server.

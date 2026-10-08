import '@mantine/core/styles.css';
import './styles.css';
import './terminal.css';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from './AppProviders';
import { router } from './router';

async function startApp() {
  if (import.meta.env.VITE_USE_MSW === 'true') {
    const { startE2EMocks } = await import('./test/e2e-msw');
    await startE2EMocks();
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  );
}

void startApp();

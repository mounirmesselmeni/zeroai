import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { classicTheme } from './theme/classic';
import { terminalTheme } from './theme/terminal';
import { useUiStore, type ThemeMode } from './stores/ui';
import { ThemeModeProvider, useThemeMode } from './theme/ThemeMode';

export const makeQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

const queryClient = makeQueryClient();

export function AppProviders({
  children,
  client = queryClient,
  initialMode,
}: {
  children: ReactNode;
  client?: QueryClient;
  /** Tests pass this; the app uses the persisted choice. */
  initialMode?: ThemeMode;
}) {
  // Apply the override once, before the first render of the tree.
  useState(() => {
    if (initialMode) useUiStore.setState({ themeMode: initialMode });
  });
  return (
    <ThemeModeProvider>
      <ThemedMantine>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </ThemedMantine>
    </ThemeModeProvider>
  );
}

/** Classic follows the OS light/dark setting; Terminal is dark only, so it forces dark. */
function ThemedMantine({ children }: { children: ReactNode }) {
  const { mode } = useThemeMode();
  const terminal = mode === 'terminal';
  return (
    <MantineProvider
      theme={terminal ? terminalTheme : classicTheme}
      defaultColorScheme="auto"
      forceColorScheme={terminal ? 'dark' : undefined}
    >
      {children}
    </MantineProvider>
  );
}

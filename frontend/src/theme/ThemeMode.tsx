import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useUiStore, type ThemeMode } from '../stores/ui';

export type { ThemeMode };

/** Keeps `<html data-theme>` in step with the store; src/terminal.css keys off that attribute. */
export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const mode = useUiStore((s) => s.themeMode);
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
  }, [mode]);
  return children;
}

/** The current theme and how to change it. A thin view over the persisted UI store. */
export function useThemeMode() {
  const mode = useUiStore((s) => s.themeMode);
  const setMode = useUiStore((s) => s.setThemeMode);
  const toggle = useUiStore((s) => s.toggleThemeMode);
  return { mode, setMode, toggle };
}

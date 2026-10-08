import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** `classic` is the monochrome shadcn-style UI; `terminal` is the dark-only phosphor shell. */
export type ThemeMode = 'classic' | 'terminal';

/** localStorage key. index.html reads it before first paint, so keep the two in sync. */
export const UI_STORAGE_KEY = 'zeroai-ui';

interface UiState {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  toggleThemeMode: () => void;
}

/** First visit: the classic theme. */
export const DEFAULT_UI = { themeMode: 'classic' } as const;

/**
 * Per-browser UI preferences, persisted to localStorage. Server-side settings (model, sources)
 * stay in the database; this store is only for how this browser looks.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      ...DEFAULT_UI,
      setThemeMode: (themeMode) => set({ themeMode }),
      toggleThemeMode: () =>
        set((s) => ({ themeMode: s.themeMode === 'terminal' ? 'classic' : 'terminal' })),
    }),
    {
      name: UI_STORAGE_KEY,
      version: 1,
      // Only data is persisted, never the actions. Blocked storage is tolerated (in memory only).
      partialize: ({ themeMode }) => ({ themeMode }),
      storage: createJSONStorage(() => localStorage),
      // A hand-edited or old value must not break the app (old versions also stored a ticker).
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as { themeMode?: string };
        return {
          ...current,
          themeMode: saved.themeMode === 'terminal' ? 'terminal' : DEFAULT_UI.themeMode,
        };
      },
    },
  ),
);

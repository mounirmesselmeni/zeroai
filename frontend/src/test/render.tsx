import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { AppProviders, makeQueryClient } from '../AppProviders';
import type { ThemeMode } from '../stores/ui';

export const renderWithProviders = (ui: ReactElement, { mode }: { mode?: ThemeMode } = {}) =>
  render(
    <AppProviders client={makeQueryClient()} initialMode={mode}>
      {ui}
    </AppProviders>,
  );

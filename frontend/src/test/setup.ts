import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

import { DEFAULT_UI, useUiStore } from '../stores/ui';

/** A fresh browser: nothing persisted. Most tests are about the classic UI; the real default
 *  (terminal) has its own tests that opt back in. */
function freshBrowser() {
  localStorage.clear();
  useUiStore.setState({ ...DEFAULT_UI, themeMode: 'classic' });
  delete document.documentElement.dataset.theme;
}

beforeEach(freshBrowser); // also the first test of a file, which has no afterEach before it
afterEach(() => {
  cleanup();
  freshBrowser();
});

// Mantine needs these browser APIs, which jsdom lacks.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
  onchange: null,
})) as unknown as typeof window.matchMedia;

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.HTMLElement.prototype.scrollIntoView = () => {};
window.scrollTo = () => {};

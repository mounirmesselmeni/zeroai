import { waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** All open tooltips. A plain DOM query: `getByRole` is far too slow on a big Mantine DOM. */
const openTooltips = () => [...document.body.querySelectorAll<HTMLElement>('[role="tooltip"]')];

/**
 * Hover `target` and return the tooltip it opens.
 *
 * Mantine tooltips open through floating-ui's hover handling, and under test (no real pointer)
 * one simulated hover sometimes lands before the handlers are live, so the tooltip never
 * appears. Re-hovering until it does makes the tests deterministic.
 */
export async function hoverTooltip(user: UserEvent, target: Element): Promise<HTMLElement> {
  // A tooltip closed a moment ago is still fading out of the DOM. Wait until nothing is open,
  // or we would return that stale one instead of the tooltip for this target.
  await user.unhover(target);
  await waitFor(() => expect(openTooltips()).toHaveLength(0), { timeout: 8000 });
  await waitFor(
    async () => {
      await user.unhover(target);
      await user.hover(target);
      expect(openTooltips()).toHaveLength(1);
    },
    { timeout: 8000, interval: 50 },
  );
  return openTooltips()[0];
}

/** Wait for any tooltip to be open (for focus-triggered ones). */
export async function findOpenTooltip(): Promise<HTMLElement> {
  await waitFor(() => expect(openTooltips().length).toBeGreaterThan(0), { timeout: 8000 });
  return openTooltips().at(-1) as HTMLElement;
}

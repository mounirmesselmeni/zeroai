import { Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { useThemeMode } from '../theme/ThemeMode';

export const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
/** The Terminal theme uses the classic shell spinner. */
export const ASCII_FRAMES = ['|', '/', '-', '\\'];

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The braille-dot spinner you see in modern CLIs (ora, cargo, npm…). */
export function BrailleSpinner({ interval = 80 }: { interval?: number }) {
  const { mode } = useThemeMode();
  const frames = mode === 'terminal' ? ASCII_FRAMES : FRAMES;
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % frames.length), interval);
    return () => clearInterval(id);
  }, [interval, frames]);
  return (
    <Text component="span" ff="monospace" fw={700} aria-hidden data-testid="spinner" inherit>
      {frames[frame % frames.length]}
    </Text>
  );
}

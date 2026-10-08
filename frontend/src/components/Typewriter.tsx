import { useEffect, useState } from 'react';

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Reveals `text` one character at a time (instantly for reduced motion or when disabled). */
export function useTypewriter(text: string, { enabled = true, speed = 28 } = {}): string {
  // The count belongs to one text: a new text starts again from zero without any reset effect.
  const [typed, setTyped] = useState({ text, count: 0 });
  const instant = !enabled || reducedMotion();

  useEffect(() => {
    if (instant) return;
    const id = setInterval(() => {
      setTyped((t) => {
        const count = t.text === text ? t.count + 1 : 1;
        if (count >= text.length) clearInterval(id);
        return { text, count: Math.min(count, text.length) };
      });
    }, speed);
    return () => clearInterval(id);
  }, [text, speed, instant]);

  if (instant) return text;
  return typed.text === text ? text.slice(0, typed.count) : '';
}

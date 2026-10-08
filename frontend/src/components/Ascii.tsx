import { Text } from '@mantine/core';

/** `[||||||||.......]`: a raw-data progress bar. `value` is clamped to 0..1. */
export function asciiBar(value: number, width = 20): string {
  const filled = Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * width);
  return `[${'|'.repeat(filled)}${'.'.repeat(width - filled)}]`;
}

export function AsciiBar({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <Text
      component="div"
      ff="monospace"
      size="sm"
      style={{ whiteSpace: 'pre' }}
      data-testid={`bar-${label.trim()}`}
    >
      {label} {asciiBar(value)} {suffix}
    </Text>
  );
}

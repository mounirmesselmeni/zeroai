/** "820 ms", "4.2 s", "1 m 05 s" */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} m ${String(Math.floor(seconds % 60)).padStart(2, '0')} s`;
}

export const formatTokens = (n: number): string => n.toLocaleString('en-US');

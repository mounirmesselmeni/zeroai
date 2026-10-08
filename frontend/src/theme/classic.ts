import { createTheme, type MantineColorsTuple } from '@mantine/core';

// shadcn "zinc": a neutral black-and-white palette.
const zinc: MantineColorsTuple = [
  '#fafafa',
  '#f4f4f5',
  '#e4e4e7',
  '#d4d4d8',
  '#a1a1aa',
  '#71717a',
  '#52525b',
  '#3f3f46',
  '#27272a',
  '#18181b',
];

// Mantine's dark scale runs light (text) -> dark (surfaces).
const dark: MantineColorsTuple = [
  '#fafafa',
  '#a1a1aa',
  '#8e8e97',
  '#52525b',
  '#27272a',
  '#1f1f23',
  '#18181b',
  '#09090b',
  '#050506',
  '#000000',
];

// Quiet, consistent field typography: medium-weight labels, small muted descriptions.
const fieldStyles = {
  label: { fontSize: 'var(--mantine-font-size-sm)', fontWeight: 500, marginBottom: 4 },
  description: { fontSize: 'var(--mantine-font-size-xs)', marginBottom: 6 },
};

export const classicTheme = createTheme({
  primaryColor: 'zinc',
  primaryShade: { light: 9, dark: 0 },
  autoContrast: true,
  colors: { zinc, dark },
  defaultRadius: 'md',
  // Geist: the shadcn/Vercel UI face. Mono for the timer, spinner and reasoning.
  fontFamily: 'Geist, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontFamilyMonospace: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  headings: { fontFamily: 'Geist, Inter, sans-serif', fontWeight: '700' },
  shadows: {
    xs: '0 1px 2px rgb(0 0 0 / 0.05)',
    sm: '0 1px 3px rgb(0 0 0 / 0.08), 0 1px 2px rgb(0 0 0 / 0.04)',
  },
  components: {
    Card: { defaultProps: { radius: 'md', withBorder: true, shadow: 'xs' } },
    Paper: { defaultProps: { radius: 'md' } },
    Button: { defaultProps: { radius: 'md', fw: 500 } },
    TextInput: { defaultProps: { radius: 'md' }, styles: fieldStyles },
    PasswordInput: { defaultProps: { radius: 'md' }, styles: fieldStyles },
    Badge: { defaultProps: { radius: 'md', variant: 'outline', color: 'zinc', fw: 500 } },
    Switch: { defaultProps: { color: 'zinc' } },
    Alert: { defaultProps: { color: 'zinc', variant: 'outline' } },
    Progress: { defaultProps: { color: 'zinc' } },
  },
});

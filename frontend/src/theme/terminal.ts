import { createTheme, type MantineColorsTuple } from '@mantine/core';

/** Design tokens for the Terminal theme (phosphor monitor). Mirrored in src/terminal.css. */
export const TERMINAL = {
  background: '#0a0a0a',
  primary: '#33ff00',
  secondary: '#ffb000',
  muted: '#1f521f',
  error: '#ff3333',
} as const;

const MONO =
  '"JetBrains Mono", "Fira Code", "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

// Neon green ramp; index 5 is the classic terminal green.
const term: MantineColorsTuple = [
  '#eaffe5',
  '#c5ffb8',
  '#9dff85',
  '#6bff47',
  '#4dff1f',
  TERMINAL.primary,
  '#2ae000',
  '#22b800',
  '#1a9000',
  '#126200',
];

// Mantine's dark scale runs text (0) to surfaces (9): 0 text, 2 dimmed, 4 borders, 6/7 surfaces.
const dark: MantineColorsTuple = [
  TERMINAL.primary,
  '#2bd400',
  '#22a800',
  '#176b17',
  TERMINAL.muted,
  '#0f2a0f',
  TERMINAL.background,
  TERMINAL.background,
  '#050505',
  '#000000',
];

const square = '0';

export const terminalTheme = createTheme({
  primaryColor: 'term',
  primaryShade: 5,
  autoContrast: true,
  colors: { term, dark },
  defaultRadius: 0,
  radius: { xs: square, sm: square, md: square, lg: square, xl: square },
  fontFamily: MONO,
  fontFamilyMonospace: MONO,
  headings: { fontFamily: MONO, fontWeight: '700' },
  shadows: { xs: 'none', sm: 'none', md: 'none', lg: 'none', xl: 'none' },
  components: {
    Card: { defaultProps: { radius: 0, withBorder: true, shadow: 'none' } },
    Paper: { defaultProps: { radius: 0 } },
    Button: { defaultProps: { radius: 0, fw: 700 } },
    TextInput: { defaultProps: { radius: 0 } },
    PasswordInput: { defaultProps: { radius: 0 } },
    Badge: { defaultProps: { radius: 0, variant: 'outline', color: 'term' } },
    Switch: { defaultProps: { color: 'term' } },
    Alert: { defaultProps: { color: 'term', variant: 'outline', radius: 0 } },
  },
});

import {
  ActionIcon,
  AppShell,
  Box,
  Group,
  Text,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { IconMoon, IconSparkles, IconSun } from '@tabler/icons-react';
import { createRootRoute, createRoute, createRouter, Link, Outlet } from '@tanstack/react-router';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { useThemeMode } from './theme/ThemeMode';
import { SettingsPage } from './pages/SettingsPage';
import { SourcesPage } from './pages/SourcesPage';
import { SummaryPage } from './pages/SummaryPage';

function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light', { getInitialValueInEffect: true });
  return (
    <ActionIcon
      variant="default"
      size="lg"
      radius="md"
      aria-label="Toggle color scheme"
      onClick={() => setColorScheme(computed === 'light' ? 'dark' : 'light')}
    >
      {computed === 'light' ? <IconMoon size={18} /> : <IconSun size={18} />}
    </ActionIcon>
  );
}

function Nav() {
  return (
    <Group gap={4} component="nav" aria-label="Main" wrap="nowrap">
      {[
        ['/', 'Summary'],
        ['/sources', 'Sources'],
        ['/settings', 'Settings'],
      ].map(([to, label]) => (
        <Link key={to} to={to} className="navlink" activeProps={{ 'data-active': true }}>
          {label}
        </Link>
      ))}
    </Group>
  );
}

function Brand() {
  const { mode } = useThemeMode();
  if (mode === 'terminal') {
    return (
      <Text fz={18} fw={700} className="brand" data-testid="brand" visibleFrom="xs">
        ZEROAI<span className="cursor">_</span>
      </Text>
    );
  }
  return (
    <Group gap="xs" wrap="nowrap">
      <IconSparkles size={24} />
      <Text fz={20} fw={700} className="brand" visibleFrom="xs" data-testid="brand">
        ZeroAI
      </Text>
    </Group>
  );
}

function Layout() {
  const { mode } = useThemeMode();
  return (
    <AppShell header={{ height: 64 }} padding={0}>
      <AppShell.Header className="header">
        <Group className="page" h="100%" justify="space-between" wrap="nowrap">
          <Brand />
          <Nav />
          <Group gap="xs" wrap="nowrap">
            <ThemeSwitcher />
            {/* Terminal is dark only, so the light/dark toggle would do nothing there. */}
            {mode === 'classic' && <ColorSchemeToggle />}
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Box className="page" py={{ base: 'md', sm: 'xl' }}>
          <Outlet />
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}

const rootRoute = createRootRoute({ component: Layout });
const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: SummaryPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/sources', component: SourcesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsPage }),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

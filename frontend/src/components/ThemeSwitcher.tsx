import { Button, Text, Tooltip } from '@mantine/core';
import { IconTerminal2 } from '@tabler/icons-react';
import { useThemeMode } from '../theme/ThemeMode';

/** Switches between the Classic UI and the Terminal ("Geek mode") theme. */
export function ThemeSwitcher() {
  const { mode, toggle } = useThemeMode();
  const terminal = mode === 'terminal';
  return (
    <Tooltip
      label={terminal ? 'Back to the classic look' : 'Geek mode: switch to the terminal theme'}
      withArrow
    >
      <Button
        variant="default"
        size="compact-md"
        aria-pressed={terminal}
        aria-label={terminal ? 'Switch to classic theme' : 'Switch to terminal theme'}
        leftSection={<IconTerminal2 size={16} />}
        onClick={toggle}
        data-testid="theme-switcher"
      >
        <Text component="span" inherit visibleFrom="sm">
          {terminal ? 'Switch to classic UI' : 'Geek mode'}
        </Text>
      </Button>
    </Tooltip>
  );
}

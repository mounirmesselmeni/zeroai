import { Box, Collapse, Group, UnstyledButton, Text } from '@mantine/core';
import { IconBrain, IconChevronDown } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { BrailleSpinner } from './BrailleSpinner';

interface Props {
  text: string;
  streaming: boolean;
}

/** The model's reasoning, streamed live. Open while thinking, collapsed once finished. */
export function ThinkingPanel({ text, streaming }: Props) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? streaming;
  const bodyRef = useRef<HTMLDivElement>(null);

  // Keep the newest reasoning in view while it streams.
  useEffect(() => {
    const el = bodyRef.current;
    if (el && streaming) el.scrollTop = el.scrollHeight;
  }, [text, streaming]);

  return (
    <Box className="muted-panel" style={{ borderRadius: 'var(--mantine-radius-md)' }}>
      <UnstyledButton
        w="100%"
        p="sm"
        onClick={() => setOverride(!open)}
        aria-expanded={open}
        aria-controls="thinking-body"
      >
        <Group gap="xs" justify="space-between" wrap="nowrap">
          <Group gap="xs">
            <IconBrain size={16} />
            <Text size="sm" fw={600}>
              {streaming ? 'Thinking' : 'Reasoning'}
            </Text>
            {streaming && (
              <Text size="sm" c="dimmed">
                <BrailleSpinner />
              </Text>
            )}
          </Group>
          <IconChevronDown
            size={16}
            style={{
              transform: open ? 'rotate(180deg)' : undefined,
              transition: 'transform 150ms',
            }}
          />
        </Group>
      </UnstyledButton>
      <Collapse expanded={open} id="thinking-body">
        <Box
          ref={bodyRef}
          px="sm"
          pb="sm"
          mah={220}
          style={{ overflowY: 'auto' }}
          data-testid="thinking-text"
        >
          <Text size="xs" c="dimmed" ff="monospace" style={{ whiteSpace: 'pre-wrap' }}>
            {text}
          </Text>
        </Box>
      </Collapse>
    </Box>
  );
}

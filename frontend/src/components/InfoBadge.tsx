import { Badge, Tooltip, type BadgeProps } from '@mantine/core';
import type { ReactNode } from 'react';

interface Props extends BadgeProps {
  /** Plain-language explanation shown on hover, keyboard focus or tap. */
  tip: ReactNode;
  'data-testid'?: string;
  children: ReactNode;
}

/** A badge that explains itself. Focusable so the tip is reachable without a mouse. */
export function InfoBadge({ tip, children, ...badge }: Props) {
  return (
    <Tooltip
      label={tip}
      multiline
      w={260}
      withArrow
      events={{ hover: true, focus: true, touch: true }}
    >
      <Badge tabIndex={0} style={{ cursor: 'help' }} {...badge}>
        {children}
      </Badge>
    </Tooltip>
  );
}

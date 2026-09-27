import React from 'react';
import {
  Badge,
  Button,
  Divider,
  Menu,
  MenuDivider,
  MenuDropdown,
  MenuItem as JustMenuItem,
  MenuLabel as JustMenuLabel,
  MenuTarget,
  SegmentedControl as JustSegmentedControl,
  Tooltip,
  cn,
} from '@codellyson/justui/react';

export function ToolbarDivider() {
  return <Divider orientation="vertical" className="h-5 mx-1 shrink-0" />;
}

// Must forward the ref and spread the rest: `MenuTarget asChild`
// clones this with its own handlers and aria/data attributes, and dropping
// them leaves a trigger that never opens.
interface ToolbarButtonProps extends Omit<React.ComponentPropsWithoutRef<'button'>, 'color'> {
  icon?: React.ReactNode;
  active?: boolean;
  variant?: 'default' | 'accent';
  badge?: number;
  /** Opt-in rich tooltip. Menu triggers keep the native `title` instead —
   *  nesting two asChild triggers stops the menu from opening. */
  tooltip?: string;
}

export const ToolbarButton = React.forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  function ToolbarButton(
    { children, icon, active, variant = 'default', badge, className, tooltip, ...rest },
    ref
  ) {
    const button = (
      <Button
        ref={ref}
        variant={variant === 'accent' ? 'primary' : 'outline'}
        size="sm"
        className={cn(
          'gap-2 px-3 text-sm',
          active && variant !== 'accent' && 'bg-bg-secondary text-primary',
          className
        )}
        {...rest}
      >
        {icon}
        {children}
        {badge != null && badge > 0 && (
          <Badge className="ml-0.5 h-4 min-w-4 px-1 text-meta leading-none">{badge}</Badge>
        )}
      </Button>
    );
    return tooltip ? <Tooltip label={tooltip}>{button}</Tooltip> : button;
  }
);

interface ToolbarMenuProps {
  label?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: number;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  align?: 'left' | 'right';
  width?: number;
  triggerClassName?: string;
  children: React.ReactNode;
}

export function ToolbarMenu({
  label,
  icon,
  badge,
  active,
  disabled,
  title,
  align = 'left',
  width = 240,
  triggerClassName,
  children,
}: ToolbarMenuProps) {
  return (
    <Menu>
      <MenuTarget asChild>
        <ToolbarButton
          icon={icon}
          badge={badge}
          active={active}
          disabled={disabled}
          title={title}
          className={cn('shrink-0', triggerClassName)}
        >
          {label}
        </ToolbarButton>
      </MenuTarget>
      <MenuDropdown
        align={align === 'right' ? 'end' : 'start'}
        width={width}
        className="max-h-80 overflow-auto origin-top animate-menu-in"
        collisionPadding={8}
      >
        {children}
      </MenuDropdown>
    </Menu>
  );
}

/** A related run of controls: tight internal spacing, one shared outline. */
export function ToolbarGroup({
  children,
  bordered,
  className,
}: {
  children: React.ReactNode;
  bordered?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center shrink-0',
        bordered ? 'gap-0.5 rounded-md border border-border h-8 px-1' : 'gap-1.5',
        className
      )}
    >
      {children}
    </div>
  );
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: React.ReactNode }>;
}

/** Track-and-thumb switch, so the view choice doesn't read as two buttons. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: SegmentedControlProps<T>) {
  return (
    <JustSegmentedControl
      value={value}
      onChange={(next) => onChange(next as T)}
      data={options.map((o) => ({ value: o.value, label: o.label, leftSection: o.icon }))}
      size="sm"
      className="shrink-0"
    />
  );
}

export function MenuItem({
  children,
  onClick,
  disabled,
  danger,
  onSelect,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Pass `(e) => e.preventDefault()` to keep the menu open after choosing. */
  onSelect?: (event: Event) => void;
}) {
  return (
    <JustMenuItem
      onClick={onClick}
      onSelect={onSelect}
      disabled={disabled}
      color={danger ? 'red' : 'default'}
      className="gap-2 text-sm"
    >
      {children}
    </JustMenuItem>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <JustMenuLabel className="text-meta uppercase tracking-wide text-muted font-normal">
      {children}
    </JustMenuLabel>
  );
}

export { MenuDivider as MenuSeparator };

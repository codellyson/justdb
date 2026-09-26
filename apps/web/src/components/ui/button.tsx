import React from 'react';
import { Button as JustButton, cn } from '@codellyson/justui/react';

interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  /** Keep dense controls stationary while retaining color feedback. */
  static?: boolean;
  children: React.ReactNode;
}

// JustUI's `secondary` is filled; this app's has always been outlined.
const VARIANT = {
  primary: 'primary',
  secondary: 'outline',
  danger: 'danger',
  ghost: 'ghost',
} as const;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', isLoading = false, static: isStatic = false, className, children, ...props },
  ref
) {
  return (
    <JustButton
      ref={ref}
      variant={VARIANT[variant]}
      size={size}
      loading={isLoading}
      data-static={isStatic || undefined}
      className={cn('app-button', size === 'sm' && 'text-sm', className)}
      {...props}
    >
      {children}
    </JustButton>
  );
});

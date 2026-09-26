import React from 'react';
import { Select as JustSelect, type SelectOption } from '@codellyson/justui/react';

interface SelectProps {
  value?: string;
  onChange?: (value: string) => void;
  /** `<option>` children are read into JustUI's options array, so call sites
   *  can keep listing their choices inline. */
  children?: React.ReactNode;
  containerClassName?: string;
  className?: string;
  inputSize?: 'sm' | 'md';
  disabled?: boolean;
  searchable?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}

function optionsFromChildren(children: React.ReactNode): SelectOption[] {
  const out: SelectOption[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child) || child.type !== 'option') return;
    const props = child.props as { value?: string; children?: React.ReactNode; disabled?: boolean };
    out.push({
      value: String(props.value ?? ''),
      label: String(props.children ?? props.value ?? ''),
      disabled: props.disabled,
    });
  });
  return out;
}

export const Select: React.FC<SelectProps> = ({
  value,
  onChange,
  children,
  containerClassName,
  className,
  inputSize = 'sm',
  disabled,
  searchable,
  placeholder,
  ariaLabel,
}) => (
  <JustSelect
    value={value}
    onChange={onChange}
    options={optionsFromChildren(children)}
    size={inputSize}
    disabled={disabled}
    searchable={searchable}
    placeholder={placeholder}
    aria-label={ariaLabel}
    className={[containerClassName, className].filter(Boolean).join(' ') || undefined}
  />
);

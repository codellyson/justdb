import React from 'react';
import { Card as JustCard, CardSection } from '@codellyson/justui/react';

interface CardProps {
  children: React.ReactNode;
  title?: string;
  className?: string;
  compactHeader?: boolean;
}

export const Card: React.FC<CardProps> = ({ children, title, className, compactHeader = false }) => (
  <JustCard withBorder padding="md" className={className}>
    {title && (
      <CardSection withBorder inheritPadding className={compactHeader ? 'pt-0 pb-2' : 'py-3'}>
        <h4 className="text-sm font-semibold text-primary">{title}</h4>
      </CardSection>
    )}
    {children}
  </JustCard>
);

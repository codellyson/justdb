
import React, { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

interface MainContentProps {
  children: React.ReactNode;
  compact?: boolean;
  transitionKey?: string;
}

export const MainContent: React.FC<MainContentProps> = ({ children, compact = false, transitionKey }) => {
  const pathname = useLocation().pathname;
  const surface = useRef<HTMLElement>(null);
  const previous = useRef(transitionKey ?? pathname);
  const animation = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const key = transitionKey ?? pathname;
    if (key === previous.current) return;
    previous.current = key;
    const element = surface.current;
    const from = animation.current?.playState === 'running' && element
      ? getComputedStyle(element).opacity : '0.65';
    animation.current?.cancel();
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Never blank or remount editors, and never move virtualized rows.
    animation.current = element.animate([{ opacity: from }, { opacity: 1 }], {
      duration: 150, easing: 'ease-out',
    });
  }, [pathname, transitionKey]);
  useLayoutEffect(() => () => animation.current?.cancel(), []);

  return (
    <main
      ref={surface}
      className={`flex-1 flex flex-col min-h-0 bg-bg ${compact ? '' : 'p-3 sm:p-4 md:p-6'} overflow-hidden`}
    >
      {children}
    </main>
  );
};

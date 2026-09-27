import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Crossfade mounted views while following the active view's natural height.
 * Keeping both mounted preserves partially filled forms and their state. */
export function AnimatedViews({ active, children }: { active: string; children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();

  useLayoutEffect(() => {
    const panel = container.current?.querySelector<HTMLElement>(':scope > [data-active="true"]');
    if (!panel) return;
    const measure = () => setHeight(panel.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [active]);

  return <div ref={container} className="animated-views" style={{ height }}>{children}</div>;
}

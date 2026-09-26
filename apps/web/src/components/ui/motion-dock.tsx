import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useMotionPresence } from '../../hooks/use-motion-presence';

/** Keep the departing panel alive until its layout space has closed.
 * Measure its natural width so resizable panels do not need a second width owner. */
export function MotionDock({ open, children, className = '' }: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  const { mounted, visible } = useMotionPresence(open, 280);
  const content = useRef<HTMLDivElement>(null);
  const lastContent = useRef(children);
  const [width, setWidth] = useState(0);
  const [settled, setSettled] = useState(false);
  useLayoutEffect(() => {
    setSettled(false);
    if (!visible) return;
    const timer = setTimeout(() => setSettled(true), 280);
    return () => clearTimeout(timer);
  }, [visible]);
  useLayoutEffect(() => {
    if (open) lastContent.current = children;
  }, [open, children]);
  useLayoutEffect(() => {
    if (!mounted || !content.current) return;
    const element = content.current;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [mounted]);
  if (!mounted) return null;
  return (
    <div className={`motion-dock ${className}`} data-open={visible} data-settled={settled} aria-hidden={!open} inert={!open}
      style={{ width: visible ? width : 0 }}>
      <div ref={content} className="motion-dock-content">{open ? children : lastContent.current}</div>
    </div>
  );
}

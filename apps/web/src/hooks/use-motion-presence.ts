import { useLayoutEffect, useState } from 'react';

/** Let a closing surface finish its transition; rapid reopening cancels removal. */
export function useMotionPresence(open: boolean, duration = 320) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    let firstFrame = 0;
    let secondFrame = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (open) {
      setMounted(true);
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      timeout = setTimeout(() => setMounted(false), reduced ? 0 : duration);
    }
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      clearTimeout(timeout);
    };
  }, [open, duration]);

  return { mounted, visible };
}

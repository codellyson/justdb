
import React, { useState, useRef, useEffect } from 'react';

interface ResizableSplitterProps {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  /** When set, the width is persisted to localStorage under this key. */
  storageKey?: string;
  /** When true, the left pane and resize handle are hidden and the right
   *  pane fills the width — the resized width is remembered for re-expand. */
  collapsed?: boolean;
}

export const ResizableSplitter: React.FC<ResizableSplitterProps> = ({
  left,
  right,
  defaultWidth = 240,
  minWidth = 160,
  maxWidth = 600,
  storageKey,
  collapsed = false,
}) => {
  const [width, setWidth] = useState(() => {
    if (!storageKey || typeof window === 'undefined') return defaultWidth;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const n = parseInt(raw, 10);
        if (!isNaN(n)) return Math.max(minWidth, Math.min(maxWidth, n));
      }
    } catch {
      // ignore
    }
    return defaultWidth;
  });

  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (isDragging || !storageKey || typeof window === 'undefined') return;
    try {
      localStorage.setItem(storageKey, String(width));
    } catch {
      // ignore
    }
  }, [storageKey, width, isDragging]);
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(defaultWidth);

  useEffect(() => {
    let frame = 0;
    let pendingWidth: number | null = null;
    const scheduleWidth = (next: number) => {
      pendingWidth = next;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        if (pendingWidth !== null) setWidth(pendingWidth);
      });
    };
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;
      const deltaX = e.clientX - startXRef.current;
      const newWidth = Math.max(
        minWidth,
        Math.min(maxWidth, startWidthRef.current + deltaX)
      );
      scheduleWidth(newWidth);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragging || !containerRef.current) return;
      e.preventDefault();
      const deltaX = e.touches[0].clientX - startXRef.current;
      const newWidth = Math.max(
        minWidth,
        Math.min(maxWidth, startWidthRef.current + deltaX)
      );
      scheduleWidth(newWidth);
    };

    const handleEnd = () => {
      if (pendingWidth !== null) setWidth(pendingWidth);
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleEnd);
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleEnd);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, minWidth, maxWidth]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    startXRef.current = e.touches[0].clientX;
    startWidthRef.current = width;
  };

  return (
    <div ref={containerRef} className="flex h-screen">
      <div
        style={{ width: collapsed ? 0 : width }}
        data-collapsed={collapsed}
        data-dragging={isDragging}
        aria-hidden={collapsed}
        inert={collapsed}
        className="workspace-sidebar flex-shrink-0 hidden md:block"
      >
        <div className="workspace-sidebar-content" style={{ width }}>{left}</div>
      </div>
      {/* Zero layout width: the sidebar already draws the seam with its own
          border-r, so any width here is an empty gutter that also offsets the
          right pane and breaks the header's border line. The grab zone is an
          overlay straddling the seam instead. */}
      {!collapsed && (
      <div
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className={`w-0 cursor-col-resize flex-shrink-0 relative z-20 hidden md:block after:absolute after:inset-y-0 after:-left-[3px] after:w-[6px] after:content-[''] after:transition-colors ${
          isDragging ? 'after:bg-accent' : 'hover:after:bg-accent/30'
        }`}
        style={{ cursor: 'col-resize' }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            setWidth((w) => Math.max(minWidth, w - 20));
          } else if (e.key === 'ArrowRight') {
            setWidth((w) => Math.min(maxWidth, w + 20));
          }
        }}
      />
      )}
      <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
        {right}
      </div>
    </div>
  );
};

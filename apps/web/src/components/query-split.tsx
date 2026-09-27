import { useRef, useState, type ReactNode, type CSSProperties } from 'react';

/** A bounded, keyboard-resizable editor/output split. Ratios survive window resizing. */
export function QuerySplit({ editor, output }: { editor: ReactNode; output: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(35);
  const drag = useRef<{ y: number; ratio: number; height: number } | null>(null);
  const clamp = (value: number) => Math.max(20, Math.min(65, value));
  return (
    <div ref={root} className="query-split" style={{ '--editor-ratio': `${ratio}%` } as CSSProperties}>
      <div className="min-h-0 overflow-hidden flex flex-col">{editor}</div>
      <div role="separator" aria-label="Resize SQL editor" aria-orientation="horizontal"
        aria-valuemin={20} aria-valuemax={65} aria-valuenow={Math.round(ratio)} tabIndex={0}
        className="query-split-handle"
        onDoubleClick={() => setRatio(35)}
        onPointerDown={event => {
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { y: event.clientY, ratio, height: root.current?.clientHeight ?? 1 };
        }}
        onPointerMove={event => {
          if (drag.current) setRatio(clamp(drag.current.ratio + (event.clientY - drag.current.y) / drag.current.height * 100));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={event => {
          if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            setRatio(value => event.key === 'Home' ? 20 : event.key === 'End' ? 65 : clamp(value + (event.key === 'ArrowUp' ? -5 : 5)));
          }
        }}><span /></div>
      <div className="min-h-0 overflow-hidden flex flex-col">{output}</div>
    </div>
  );
}

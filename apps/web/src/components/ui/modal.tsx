import React, { useLayoutEffect, useRef } from 'react';
import { Modal as JustModal } from '@codellyson/justui/react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
  preventClose?: boolean;
  width?: number;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen, onClose, title, children, className, preventClose = false, width = 448,
}) => {
  const body = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (isOpen) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) opener.current = active;
      const frame = window.setTimeout(() => {
        body.current?.querySelector<HTMLElement>('[data-modal-autofocus]')?.focus();
      });
      return () => {
        window.clearTimeout(frame);
        const target = opener.current;
        window.setTimeout(() => { if (target?.isConnected) target.focus(); });
      };
    }
    // Some pointer-triggered controls don't take focus (notably in WebKit).
    const remember = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button, [role="button"], [role="menuitem"]') : null;
      if (target) opener.current = target;
    };
    document.addEventListener('pointerdown', remember, true);
    return () => document.removeEventListener('pointerdown', remember, true);
  }, [isOpen]);

  // Unmount closed portals explicitly; don't leave a closed animation waiting
  // for an animationend event and blocking the workspace.
  if (!isOpen) return null;
  return (
    <JustModal
      opened onClose={() => { if (!preventClose) onClose(); }} title={title}
      width={`min(${width}px, 92vw)`}
      withCloseButton={!preventClose} closeOnClickOutside={!preventClose}
      closeOnEscape={!preventClose} swipeToClose={!preventClose}
      withDragHandle={!preventClose} contentScrollable
      overlayClassName="app-modal-overlay"
      className={`app-modal ${className ?? ''}`}
    >
      <div ref={body}>{children}</div>
    </JustModal>
  );
};

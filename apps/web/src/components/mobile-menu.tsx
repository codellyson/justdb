
import React, { useEffect } from "react";
import { X } from 'lucide-react';
import { useMotionPresence } from '../hooks/use-motion-presence';

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export const MobileMenu: React.FC<MobileMenuProps> = ({
  isOpen,
  onClose,
  children,
}) => {
  const { mounted, visible } = useMotionPresence(isOpen, 280);
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!mounted) return null;

  return (
    <div className="mobile-workspace-menu fixed inset-0 z-40 md:hidden" data-open={visible} aria-hidden={!isOpen} inert={!isOpen}>
      <div
        className="mobile-workspace-backdrop fixed inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="mobile-workspace-drawer fixed inset-y-0 left-0 w-[280px] z-50 bg-bg border-r border-border overflow-y-auto shadow-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold text-primary">JustDB</span>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted hover:text-primary hover:bg-bg-secondary transition-colors"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
};

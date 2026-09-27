
import { useEffect, useState } from "react";
import { useToast, useToasts, type ToastType } from "../../contexts/toast-context";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';

const typeStyles: Record<ToastType, { bg: string; tone: string; Icon: LucideIcon }> = {
  success: { bg: "border-l-success", tone: "text-success", Icon: CircleCheck },
  error: { bg: "border-l-danger", tone: "text-danger", Icon: CircleAlert },
  warning: { bg: "border-l-warning", tone: "text-warning", Icon: TriangleAlert },
  info: { bg: "border-l-accent", tone: "text-accent", Icon: Info },
};

function ToastItem({
  id,
  message,
  type,
  onRemove,
}: {
  id: string;
  message: string;
  type: ToastType;
  onRemove: (id: string) => void;
}) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const handleRemove = () => {
    setIsVisible(false);
    setTimeout(() => onRemove(id), 150);
  };

  const style = typeStyles[type];

  return (
    <div
      role="alert"
      className={`
        flex items-center gap-3
        bg-bg border border-border border-l-4 ${style.bg}
        floating-surface rounded-xl pl-4 pr-2 py-2 text-sm text-primary
        transition-[opacity,translate] duration-150 ease-out
        ${isVisible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}
      `}
    >
      <style.Icon className={`h-4 w-4 flex-shrink-0 ${style.tone}`} />
      <span className="min-w-0 flex-1 break-words">{message}</span>
      <button
        onClick={handleRemove}
        className="flex size-8 items-center justify-center rounded-lg flex-shrink-0 text-muted hover:bg-bg-secondary hover:text-primary transition-colors"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToasts();
  const { removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]"
    >
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          id={toast.id}
          message={toast.message}
          type={toast.type}
          onRemove={removeToast}
        />
      ))}
    </div>
  );
}

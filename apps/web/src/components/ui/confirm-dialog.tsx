import React, { useState } from 'react';
import { Modal } from './modal';
import { Button } from './button';

interface ConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  title?: string;
  message: string;
  confirmText?: string;
  variant?: 'danger' | 'primary';
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ isOpen, onConfirm, onCancel, title = 'Confirm action', message, confirmText = 'Confirm', variant = 'danger' }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = () => { if (!busy) { setError(null); onCancel(); } };
  const confirm = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await onConfirm(); }
    catch (err) { setError(err instanceof Error ? err.message : 'The action failed. Please try again.'); }
    finally { setBusy(false); }
  };
  return (
    <Modal isOpen={isOpen} onClose={cancel} title={title} preventClose={busy}>
      <p className="text-sm leading-relaxed text-secondary">{message}</p>
      {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
      <div className="modal-actions">
        <Button data-modal-autofocus variant="secondary" size="sm" onClick={cancel} disabled={busy}>Cancel</Button>
        <Button variant={variant} size="sm" onClick={() => void confirm()} isLoading={busy} disabled={busy}>{confirmText}</Button>
      </div>
    </Modal>
  );
};

import React, { useId, useState } from 'react';
import { Modal } from './ui/modal';
import { Button } from './ui/button';
import { TriangleAlert } from 'lucide-react';
import { useConnection } from '../contexts/connection-context';
import { splitSqlStatements } from '@/lib/sql-statements';

interface QueryExecutionConfirmationProps {
  isOpen: boolean;
  sql: string;
  statement: string;
  kind: 'write' | 'ddl';
  isBulkWrite: boolean;
  requiresTypedConfirmation: boolean;
  reason?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export const QueryExecutionConfirmation: React.FC<QueryExecutionConfirmationProps> = ({
  isOpen, sql, statement, kind, isBulkWrite, requiresTypedConfirmation, reason,
  onConfirm, onCancel, isLoading = false,
}) => {
  const { databaseName } = useConnection();
  const [typedValue, setTypedValue] = useState('');
  const inputId = useId();
  const confirmText = statement.toUpperCase();
  const isTypedCorrect = typedValue.trim().toUpperCase() === confirmText;
  const dangerous = ['DELETE', 'DROP', 'TRUNCATE'].includes(statement) || isBulkWrite;
  const count = splitSqlStatements(sql).length;
  const consequence = reason ?? (isBulkWrite
    ? `This ${statement} has no outer WHERE clause. It can affect every row in its target table.`
    : ['DROP', 'TRUNCATE'].includes(statement) ? 'This operation removes database objects or their data.'
    : statement === 'DELETE' ? 'Matching rows will be deleted. Related rows may also be affected by foreign-key rules.'
    : ['COMMIT', 'END'].includes(statement) ? 'This commits the changes in the current transaction.'
    : kind === 'ddl' ? 'This changes the database structure.'
    : 'This statement may change data or database state. Review the SQL before running it.');
  const cancel = () => { if (!isLoading) { setTypedValue(''); onCancel(); } };
  const confirm = () => {
    if (isLoading || (requiresTypedConfirmation && !isTypedCorrect)) return;
    setTypedValue(''); onConfirm();
  };
  return (
    <Modal isOpen={isOpen} onClose={cancel} title={count > 1 ? `Run ${count} SQL statements?` : `Run ${statement}?`} preventClose={isLoading} width={640}>
      <p className="mb-4 text-sm text-secondary">Database: <strong className="font-medium text-primary">{databaseName ?? 'Current connection'}</strong></p>
      <div className={`flex items-start gap-3 border-l-2 pl-3 ${dangerous ? 'border-danger' : 'border-warning'}`}>
        <TriangleAlert aria-hidden className={`mt-0.5 size-4 shrink-0 ${dangerous ? 'text-danger' : 'text-warning'}`} />
        <p className="text-sm leading-relaxed text-secondary">{consequence}</p>
      </div>
      {count > 1 && <p className="mt-3 text-sm text-secondary">All {count} statements below will run in order. Without an explicit transaction, earlier changes may remain if a later statement fails.</p>}
      <pre className="my-5 max-h-[35vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-bg-secondary/40 p-4 font-mono text-sm text-primary">{sql}</pre>
      {requiresTypedConfirmation && <div>
        <label htmlFor={inputId} className="mb-2 block text-sm text-secondary">Type <strong className="font-mono text-primary">{confirmText}</strong> to confirm</label>
        <input id={inputId} data-modal-autofocus value={typedValue} disabled={isLoading}
          onChange={event => setTypedValue(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); confirm(); } }}
          autoComplete="off" spellCheck={false}
          className="h-9 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-primary" />
      </div>}
      <div className="modal-actions">
        <Button data-modal-autofocus={requiresTypedConfirmation ? undefined : true} variant="secondary" size="sm" onClick={cancel} disabled={isLoading}>Cancel</Button>
        <Button variant={dangerous ? 'danger' : 'primary'} size="sm" onClick={confirm} isLoading={isLoading} disabled={isLoading || (requiresTypedConfirmation && !isTypedCorrect)}>
          {count > 1 ? `Run ${count} statements` : `Run ${statement}`}
        </Button>
      </div>
    </Modal>
  );
};

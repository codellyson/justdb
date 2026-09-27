import { getExperienceMode } from '@/lib/app-settings';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from './ui/modal';
import { Button } from './ui/button';
import { useConnection } from '../contexts/connection-context';
import { useToast } from '../contexts/toast-context';
import { usePendingChanges } from '../contexts/pending-changes-context';
import { useDashboardActions } from '../contexts/dashboard-context';
import { buildDisplaySQL, type MutationRequest } from '@/lib/mutation';
import { db } from '@/lib/db';
import { CascadeImpactPanel } from './cascade-impact-panel';
import type { CascadeNodeRequest, CascadeResult } from '@/lib/cascade';
import { Checkbox } from '@codellyson/justui/react';

interface ReviewSqlModalProps {
  isOpen: boolean;
  onClose: () => void;
  schema: string;
  table: string;
}

const typeColor: Record<MutationRequest['type'], string> = {
  INSERT: 'text-success',
  UPDATE: 'text-warning',
  DELETE: 'text-danger',
};

const EXTENDED_OPTIONS = {
  timeBudgetMs: 30000,
  maxDepth: 12,
  maxPerTable: 100000,
};

export const ReviewSqlModal: React.FC<ReviewSqlModalProps> = ({
  isOpen,
  onClose,
  schema,
  table,
}) => {
  const expert = getExperienceMode() === 'expert';
  const { databaseType, databaseName } = useConnection();
  const { addToast } = useToast();
  const pending = usePendingChanges();
  const { refreshTableData } = useDashboardActions();
  const [isSaving, setIsSaving] = useState(false);

  const [cascadeLoading, setCascadeLoading] = useState(false);
  const [cascadeError, setCascadeError] = useState<string | null>(null);
  const [cascadeResult, setCascadeResult] = useState<CascadeResult | null>(null);
  const [extendedAttempted, setExtendedAttempted] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const requests = useMemo(
    () => (isOpen ? pending.buildMutationRequests({ schema, table }) : []),
    [isOpen, pending, schema, table]
  );

  const previews = requests.map(request => buildDisplaySQL(request, databaseType));
  const previewFailed = previews.some(sql => sql === '-- Unable to generate preview --');
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => { if (isOpen) setSaveError(null); }, [isOpen]);

  const counts = useMemo(() => {
    const result = { INSERT: 0, UPDATE: 0, DELETE: 0 };
    for (const r of requests) result[r.type]++;
    return result;
  }, [requests]);

  const deleteRequests = useMemo(
    () => requests.filter((r): r is MutationRequest & { where: Record<string, any> } =>
      r.type === 'DELETE' && !!r.where
    ),
    [requests]
  );

  const cascadeNodes = useMemo<CascadeNodeRequest[]>(() => {
    const grouped = new Map<string, CascadeNodeRequest>();
    for (const r of deleteRequests) {
      const key = `${r.schema}.${r.table}`;
      const node = grouped.get(key) ?? { schema: r.schema, table: r.table, pks: [] };
      node.pks.push(r.where);
      grouped.set(key, node);
    }
    return Array.from(grouped.values());
  }, [deleteRequests]);

  const runCascade = useCallback(
    async (extended: boolean) => {
      if (cascadeNodes.length === 0) return;
      setCascadeLoading(true);
      setCascadeError(null);
      try {
        const body: { deletes: CascadeNodeRequest[]; options?: typeof EXTENDED_OPTIONS } = {
          deletes: cascadeNodes,
        };
        if (extended) body.options = EXTENDED_OPTIONS;

        const res = await db.cascadePreview(body.deletes, body.options) as CascadeResult;
        setCascadeResult({
          cascade: res.cascade,
          setNull: res.setNull,
          blocked: res.blocked,
          truncated: res.truncated,
          elapsedMs: res.elapsedMs,
          warnings: res.warnings,
        });
        if (extended) setExtendedAttempted(true);
      } catch (err: any) {
        setCascadeError(err?.message || 'Cascade preview failed');
      } finally {
        setCascadeLoading(false);
      }
    },
    [cascadeNodes]
  );

  useEffect(() => {
    if (!isOpen) {
      setCascadeResult(null);
      setCascadeError(null);
      setExtendedAttempted(false);
      setAcknowledged(false);
      return;
    }
    if (expert || cascadeNodes.length === 0) {
      setCascadeResult(null);
      setCascadeError(null);
      return;
    }
    setExtendedAttempted(false);
    setAcknowledged(false);
    runCascade(false);
  }, [isOpen, cascadeNodes, runCascade, expert]);

  const hasCascadeImpact =
    !!cascadeResult &&
    (cascadeResult.cascade.length > 0 ||
      cascadeResult.setNull.length > 0 ||
      cascadeResult.blocked.length > 0 ||
      cascadeResult.truncated || cascadeResult.warnings.length > 0);

  const requiresAck = !expert && (hasCascadeImpact || !!cascadeError);

  const handleSave = async () => {
    if (requests.length === 0) {
      onClose();
      return;
    }
    if (isSaving || cascadeLoading || previewFailed) return;
    if (requiresAck && !acknowledged) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      await db.mutateBatch(requests);
      pending.clearAfterSave({ schema, table });
      await refreshTableData();
      addToast(
        `Saved ${requests.length} ${requests.length === 1 ? 'change' : 'changes'}`,
        'success'
      );
      onClose();
    } catch (err: any) {
      setSaveError(err.message || 'Save failed — all changes rolled back');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Review changes" width={720} preventClose={isSaving}>
      <div className="space-y-4">
        <p className="text-sm text-secondary">{databaseName} <span aria-hidden> / </span> <strong className="font-medium text-primary">{schema}.{table}</strong></p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-secondary">
          <span>{requests.length} statement{requests.length === 1 ? '' : 's'}</span>
          {counts.INSERT > 0 && (
            <span className="text-success">{counts.INSERT} insert{counts.INSERT === 1 ? '' : 's'}</span>
          )}
          {counts.UPDATE > 0 && (
            <span className="text-warning">{counts.UPDATE} update{counts.UPDATE === 1 ? '' : 's'}</span>
          )}
          {counts.DELETE > 0 && (
            <span className="text-danger">{counts.DELETE} delete{counts.DELETE === 1 ? '' : 's'}</span>
          )}
          <span className="text-muted">runs in a single transaction</span>
        </div>

        {!expert && deleteRequests.length > 0 && (
          <CascadeImpactPanel
            loading={cascadeLoading}
            error={cascadeError}
            result={cascadeResult}
            extendedAttempted={extendedAttempted}
            onRunFullPreview={() => runCascade(true)}
            onRetry={() => runCascade(false)}
          />
        )}

        {previewFailed && <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">SQL preview unavailable. Complete or correct the staged rows before saving.</p>}
        {saveError && <p role="alert" className="text-sm text-danger">{saveError}</p>}
        <div className="border border-border rounded-md overflow-hidden">
          <div className="max-h-[40vh] overflow-y-auto divide-y divide-border">
            {requests.length === 0 ? (
              <div className="p-4 text-sm text-muted text-center">No pending changes.</div>
            ) : (
              requests.map((r, i) => (
                <pre
                  key={i}
                  className="p-4 text-sm font-mono whitespace-pre-wrap break-all bg-bg-secondary/30"
                >
                  <span className={previews[i] === '-- Unable to generate preview --' ? 'text-danger' : typeColor[r.type]}>{previews[i]};</span>
                </pre>
              ))
            )}
          </div>
        </div>

        {requiresAck && !cascadeLoading && (
          <div className="px-1 select-none">
            <Checkbox
              checked={acknowledged}
              onChange={(checked) => setAcknowledged(checked === true)}
              disabled={isSaving}
              label={
                <span className="text-sm text-secondary">
                  I’ve reviewed the impact above and want to proceed.
                </span>
              }
            />
          </div>
        )}

        <div className="modal-actions">
          <Button data-modal-autofocus variant="secondary" size="sm" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant={!expert && counts.DELETE > 0 ? "danger" : "primary"}
            size="sm"
            onClick={handleSave}
            isLoading={isSaving}
            disabled={
              isSaving ||
              requests.length === 0 ||
              previewFailed ||
              cascadeLoading ||
              (requiresAck && !acknowledged)
            }
          >
            Save {requests.length} {requests.length === 1 ? 'change' : 'changes'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

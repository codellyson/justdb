
import React, { useState, useCallback } from "react";
import Papa from "papaparse";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";
import { Select } from "./ui/select";
import { ColumnInfo } from "@/types";
import { db } from "@/lib/db";
import { ArrowRight, UploadCloud } from 'lucide-react';

interface CSVImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  schema: string;
  columns: ColumnInfo[];
  onComplete: () => void;
}

type Step = "upload" | "mapping" | "confirm";

const SKIP_COLUMN = "__skip__";

export const CSVImportDialog: React.FC<CSVImportDialogProps> = ({
  isOpen,
  onClose,
  tableName,
  schema,
  columns,
  onComplete,
}) => {
  const [step, setStep] = useState<Step>("upload");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const resetState = useCallback(() => {
    setStep("upload");
    setCsvHeaders([]);
    setCsvData([]);
    setColumnMapping({});
    setIsImporting(false);
    setError(null);
    setImportResult(null);
  }, []);

  const handleClose = () => {
    resetState();
    onClose();
  };

  const processFile = (file: File) => {
    setError(null);
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = result.data as string[][];
        if (rows.length < 2) {
          setError("CSV file must have at least a header row and one data row.");
          return;
        }

        const headers = rows[0];
        const data = rows.slice(1);
        setCsvHeaders(headers);
        setCsvData(data);

        // Auto-map: match CSV headers to table columns by name (case-insensitive)
        const mapping: Record<string, string> = {};
        for (const header of headers) {
          const match = columns.find(
            (col) => col.name.toLowerCase() === header.toLowerCase()
          );
          mapping[header] = match ? match.name : SKIP_COLUMN;
        }
        setColumnMapping(mapping);
        setStep("mapping");
      },
      error: (err) => {
        setError(`Failed to parse CSV: ${err.message}`);
      },
    });
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith(".csv")) {
      processFile(file);
    } else {
      setError("Please drop a .csv file.");
    }
  };

  const handleImport = async () => {
    setIsImporting(true);
    setError(null);

    // Build mapped columns and rows
    const mappedCsvHeaders = csvHeaders.filter(
      (h) => columnMapping[h] && columnMapping[h] !== SKIP_COLUMN
    );
    const targetColumns = mappedCsvHeaders.map((h) => columnMapping[h]);
    const mappedIndices = mappedCsvHeaders.map((h) => csvHeaders.indexOf(h));

    const rows = csvData.map((row) =>
      mappedIndices.map((idx) => row[idx] ?? null)
    );

    try {
      const data = await db.importRows({
        schema,
        table: tableName,
        columns: targetColumns,
        rows,
      });

      setImportResult(data.insertedRows);
      onComplete();
    } catch (err: any) {
      setError(err.message || "Import failed");
    } finally {
      setIsImporting(false);
    }
  };

  const mappedCount = Object.values(columnMapping).filter(
    (v) => v && v !== SKIP_COLUMN
  ).length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Import CSV into ${tableName}`}
      width={512}
    >
      <div className="space-y-4">
        {error && (
          <div className="px-3 py-2 text-sm text-danger bg-danger/10 border border-danger/20 rounded-md">
            {error}
          </div>
        )}

        {importResult !== null && (
          <div className="px-3 py-2 text-sm text-success bg-success/10 border border-success/20 rounded-md">
            Successfully imported {importResult} rows.
          </div>
        )}

        {step === "upload" && (
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragOver
                ? "border-accent bg-accent/5"
                : "border-border hover:border-accent/50"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
          >
            <div className="text-muted mb-3">
              <UploadCloud className="h-10 w-10 mx-auto mb-2" />
              <p className="text-sm">Drag and drop a CSV file here</p>
              <p className="text-xs mt-1">or</p>
            </div>
            <label className="inline-block">
              <input
                type="file"
                accept=".csv"
                onChange={handleFileInput}
                className="hidden"
              />
              <span className="px-4 py-2 text-sm font-medium bg-accent text-[rgb(var(--accent-text))] rounded-md cursor-pointer hover:bg-accent-hover transition-colors">
                Choose file
              </span>
            </label>
          </div>
        )}

        {step === "mapping" && (
          <>
            <div className="text-sm text-secondary mb-2">
              {csvData.length} rows found. Map CSV columns to table columns:
            </div>
            <div className="max-h-60 overflow-y-auto space-y-2">
              {csvHeaders.map((header) => (
                <div
                  key={header}
                  className="flex items-center gap-3"
                >
                  <span className="text-sm font-mono text-primary w-1/3 truncate flex-shrink-0">
                    {header}
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted flex-shrink-0" />
                  <Select
                    containerClassName="flex-1"
                    value={columnMapping[header] || SKIP_COLUMN}
                    onChange={(v) =>
                      setColumnMapping((prev) => ({ ...prev, [header]: v }))
                    }
                  >
                    <option value={SKIP_COLUMN}>-- Skip --</option>
                    {columns.map((col) => (
                      <option key={col.name} value={col.name}>
                        {col.name} ({col.type})
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>

            {/* Preview */}
            {csvData.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-medium text-secondary mb-1">
                  Preview (first 3 rows)
                </div>
                <div className="overflow-x-auto border border-border rounded-md">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-bg-secondary">
                        {csvHeaders.map((h) => (
                          <th
                            key={h}
                            className="px-2 py-1.5 text-left font-medium text-secondary border-b border-border"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csvData.slice(0, 3).map((row, ri) => (
                        <tr key={ri} className="border-b border-border last:border-b-0">
                          {row.map((cell, ci) => (
                            <td
                              key={ci}
                              className="px-2 py-1 text-primary font-mono truncate max-w-[120px]"
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-between items-center pt-2">
              <Button variant="secondary" onClick={() => setStep("upload")}>
                Back
              </Button>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted">
                  {mappedCount} of {csvHeaders.length} columns mapped
                </span>
                <Button
                  variant="primary"
                  onClick={() => setStep("confirm")}
                  disabled={mappedCount === 0}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}

        {step === "confirm" && (
          <>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-1">
                <span className="text-secondary">Table</span>
                <span className="font-mono text-primary">
                  {schema}.{tableName}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-secondary">Rows to import</span>
                <span className="font-mono text-primary">{csvData.length}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-secondary">Columns mapped</span>
                <span className="font-mono text-primary">{mappedCount}</span>
              </div>
              <div className="border-t border-border pt-2 mt-2">
                <div className="text-xs text-secondary mb-1">Column mapping:</div>
                {csvHeaders
                  .filter((h) => columnMapping[h] !== SKIP_COLUMN)
                  .map((h) => (
                    <div
                      key={h}
                      className="flex justify-between text-xs py-0.5"
                    >
                      <span className="font-mono text-muted">{h}</span>
                      <span className="font-mono text-primary">
                        {columnMapping[h]}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
            <div className="flex justify-between pt-4">
              <Button variant="secondary" onClick={() => setStep("mapping")}>
                Back
              </Button>
              <Button
                variant="primary"
                onClick={handleImport}
                isLoading={isImporting}
                disabled={isImporting}
              >
                Import {csvData.length} rows
              </Button>
            </div>
          </>
        )}

        {importResult !== null && (
          <div className="flex justify-end pt-2">
            <Button variant="primary" onClick={handleClose}>
              Done
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
};

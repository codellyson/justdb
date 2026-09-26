
import React, { useState } from "react";
import { ColumnInfo } from "@/types";

interface TableSchemaProps {
  columns: ColumnInfo[];
  indexes?: any[];
  constraints?: any[];
}

export const TableSchema: React.FC<TableSchemaProps> = ({
  columns,
  indexes: _indexes,
  constraints: _constraints,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="mb-8 border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-bg-secondary hover:bg-bg-secondary/80 transition-colors"
        aria-expanded={isExpanded}
        aria-controls="schema-table"
        aria-label={isExpanded ? "Collapse table schema" : "Expand table schema"}
      >
        <h3 className="text-sm font-medium text-primary">
          Table schema
        </h3>
        <span className="text-muted text-xs" aria-hidden="true">
          {isExpanded ? "\u25BC" : "\u25B6"}
        </span>
      </button>
      {isExpanded && (
        <div id="schema-table" className="p-0 overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead className="bg-bg-secondary">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-secondary border-b border-border max-w-xs">
                  Column
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-secondary border-b border-border max-w-xs">
                  Type
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-secondary border-b border-border">
                  Nullable
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-secondary border-b border-border max-w-xs">
                  Default
                </th>
              </tr>
            </thead>
            <tbody className="bg-bg">
              {columns.map((column, index) => (
                <tr key={index} className="border-b border-border last:border-b-0 hover:bg-bg-secondary/30">
                  <td
                    className="px-4 py-2 text-sm text-primary font-mono max-w-xs"
                    title={column.name}
                  >
                    <div className="truncate flex items-center gap-2">
                      <span className="truncate">{column.name}</span>
                      {column.isPrimaryKey && (
                        <span className="text-meta font-medium bg-accent/10 text-accent px-1.5 py-0.5 rounded-sm flex-shrink-0">
                          PK
                        </span>
                      )}
                    </div>
                  </td>
                  <td
                    className="px-4 py-2 text-sm text-primary font-mono max-w-xs"
                    title={column.type}
                  >
                    <div className="truncate">{column.type}</div>
                  </td>
                  <td className="px-4 py-2 text-sm text-secondary">
                    {column.nullable ? "Yes" : "No"}
                  </td>
                  <td
                    className="px-4 py-2 text-sm text-primary font-mono max-w-xs"
                    title={column.default || "\u2014"}
                  >
                    <div className="truncate">
                      {column.default || <span className="text-muted">\u2014</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

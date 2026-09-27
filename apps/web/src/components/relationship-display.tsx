
import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';

interface ForeignKey {
  constraint_name: string;
  source_column: string;
  target_schema: string;
  target_table: string;
  target_column: string;
}

interface Index {
  index_name: string;
  index_type: string;
  is_unique: boolean;
  is_primary: boolean;
  columns: string[];
}

interface RelationshipDisplayProps {
  relationships: ForeignKey[];
  indexes: Index[];
  onNavigateToTable?: (table: string) => void;
}

export const RelationshipDisplay: React.FC<RelationshipDisplayProps> = ({
  relationships,
  indexes,
  onNavigateToTable,
}) => {
  const [showRelationships, setShowRelationships] = useState(true);
  const [showIndexes, setShowIndexes] = useState(false);

  if (relationships.length === 0 && indexes.length === 0) return null;

  return (
    <div className="space-y-4 mb-8">
      {relationships.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowRelationships(!showRelationships)}
            className="w-full flex items-center justify-between px-4 py-3 bg-bg-secondary hover:bg-bg-secondary/80 transition-colors text-sm"
            aria-expanded={showRelationships}
          >
            <span className="font-medium text-primary">Foreign keys ({relationships.length})</span>
            <span className="text-muted text-xs">{showRelationships ? '\u2212' : '+'}</span>
          </button>
          {showRelationships && (
            <div className="p-4 space-y-2">
              {relationships.map((fk, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-primary">
                  <span className="font-mono font-medium">{fk.source_column}</span>
                  <ArrowRight className="h-3 w-3 text-muted" />
                  {onNavigateToTable ? (
                    <button
                      onClick={() => onNavigateToTable(fk.target_table)}
                      className="font-mono font-medium text-accent hover:text-accent/80 underline underline-offset-4"
                    >
                      {fk.target_table}.{fk.target_column}
                    </button>
                  ) : (
                    <span className="font-mono font-medium">{fk.target_table}.{fk.target_column}</span>
                  )}
                  <span className="text-xs text-muted ml-2">
                    ({fk.constraint_name})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {indexes.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowIndexes(!showIndexes)}
            className="w-full flex items-center justify-between px-4 py-3 bg-bg-secondary hover:bg-bg-secondary/80 transition-colors text-sm"
            aria-expanded={showIndexes}
          >
            <span className="font-medium text-primary">Indexes ({indexes.length})</span>
            <span className="text-muted text-xs">{showIndexes ? '\u2212' : '+'}</span>
          </button>
          {showIndexes && (
            <div className="p-4 space-y-2">
              {indexes.map((idx, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-primary flex-wrap">
                  <span className="font-mono font-medium">{idx.index_name}</span>
                  <span className="text-meta px-1.5 py-0.5 rounded-sm bg-bg-secondary text-secondary border border-border">
                    {idx.index_type}
                  </span>
                  {idx.is_primary && (
                    <span className="text-meta px-1.5 py-0.5 rounded-sm bg-accent/10 text-accent font-medium">
                      PK
                    </span>
                  )}
                  {idx.is_unique && !idx.is_primary && (
                    <span className="text-meta px-1.5 py-0.5 rounded-sm bg-accent/10 text-accent font-medium">
                      Unique
                    </span>
                  )}
                  <span className="text-muted font-mono text-xs">
                    ({Array.isArray(idx.columns) ? idx.columns.join(', ') : String(idx.columns)})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

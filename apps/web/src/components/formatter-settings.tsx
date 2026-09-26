
import React, { useState } from "react";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";
import { Select } from "./ui/select";
import { DEFAULT_FORMATTERS } from "@/lib/default-plugins";
import type { FormatterPreset, FormatterMatcher } from "@/lib/plugin-types";
import { usePlugins } from "../hooks/use-plugins";
import { Input, Switch } from '@codellyson/justui/react';

interface FormatterSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Standalone modal wrapper — kept for existing callers. */
export const FormatterSettings: React.FC<FormatterSettingsProps> = ({ isOpen, onClose }) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Data Formatters" width={512}>
    <FormatterSettingsBody />
  </Modal>
);

const PRESET_OPTIONS: { value: FormatterPreset; label: string }[] = [
  { value: "relative-date", label: "Relative Date" },
  { value: "json-pretty", label: "Pretty JSON" },
  { value: "boolean-badge", label: "Boolean Badge" },
  { value: "byte-size", label: "Byte Size" },
  { value: "truncate-long", label: "Truncate Long" },
  { value: "url-link", label: "URL Link" },
  { value: "number-comma", label: "Number Comma" },
];

const MATCHER_TYPE_OPTIONS: { value: FormatterMatcher["type"]; label: string }[] = [
  { value: "data-type", label: "Data Type" },
  { value: "column-name", label: "Column Name" },
  { value: "column-name-pattern", label: "Column Name Pattern" },
];

/** Reusable body (no Modal wrapper) so the Settings screen can embed it. */
export const FormatterSettingsBody: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { config, allFormatters, addFormatter, deleteFormatter, toggleBuiltIn } = usePlugins();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMatcherType, setNewMatcherType] = useState<FormatterMatcher["type"]>("data-type");
  const [newMatcherValue, setNewMatcherValue] = useState("");
  const [newPreset, setNewPreset] = useState<FormatterPreset>("relative-date");

  const handleAdd = () => {
    if (!newName.trim() || !newMatcherValue.trim()) return;
    addFormatter({
      name: newName,
      description: `Custom formatter: ${newPreset} for ${newMatcherType} '${newMatcherValue}'`,
      matcher: { type: newMatcherType, value: newMatcherValue },
      preset: newPreset,
    });
    setNewName("");
    setNewMatcherValue("");
    setShowAddForm(false);
  };

  return (
    <div className="space-y-4">
        {!embedded && <p className="mt-1 text-xs leading-relaxed text-muted">Change how values appear without changing stored data.</p>}

        <div className="space-y-2">
          <div className="text-sm font-medium text-secondary">Built-in</div>
          {DEFAULT_FORMATTERS.map((f) => {
            const isDisabled = config.disabledBuiltIns.includes(f.id);
            return (
              <div
                key={f.id}
                className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-0"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-primary">{f.name}</div>
                  <div className="mt-1 text-meta leading-relaxed text-muted">
                    {f.description}
                  </div>
                </div>
                <Switch
                  checked={!isDisabled}
                  onChange={() => toggleBuiltIn(f.id)}
                  size="sm"
                  aria-label={`Enable ${f.name}`}
                />
              </div>
            );
          })}
        </div>

        {allFormatters.filter((f) => !f.isBuiltIn).length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium text-secondary">Custom</div>
            {allFormatters
              .filter((f) => !f.isBuiltIn)
              .map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-0"
                >
                  <div>
                    <div className="text-sm font-medium text-primary">{f.name}</div>
                    <div className="mt-1 text-meta leading-relaxed text-muted">
                      {f.description}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteFormatter(f.id)}
                    className="text-xs text-danger hover:text-danger/80"
                  >
                    Remove
                  </button>
                </div>
              ))}
          </div>
        )}

        {showAddForm ? (
          <div className="space-y-3 border border-border rounded-md p-3 bg-bg-secondary">
            <div className="text-sm font-medium text-secondary">New Formatter</div>
            <Input
              value={newName}
              onChange={setNewName}
              placeholder="Formatter name"
              containerClassName="w-full"
            />
            <div className="flex gap-2">
              <Select
                containerClassName="flex-1"
                value={newMatcherType}
                onChange={(v) => setNewMatcherType(v as FormatterMatcher["type"])}
              >
                {MATCHER_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
              <Input
                value={newMatcherValue}
                onChange={setNewMatcherValue}
                placeholder="e.g. timestamp"
                containerClassName="flex-1"
                className="font-mono"
              />
            </div>
            <Select
              value={newPreset}
              onChange={(v) => setNewPreset(v as FormatterPreset)}
            >
              {PRESET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowAddForm(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleAdd}
                disabled={!newName.trim() || !newMatcherValue.trim()}
              >
                Add
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setShowAddForm(true)}>
            + Add formatter
          </Button>
        )}
    </div>
  );
};

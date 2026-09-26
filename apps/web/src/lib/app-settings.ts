/**
 * Small localStorage-backed store for miscellaneous app preferences exposed
 * in the Settings screen. Consumers read these at point-of-use (they're read
 * infrequently), so no context/subscription is needed.
 */

const KEYS = {
  rowCap: 'justdb-result-row-cap',
  idleMin: 'justdb-idle-timeout-min',
  lineNumbers: 'justdb-editor-line-numbers',
  telemetry: 'justdb-telemetry-enabled',
  telemetryNoticeSeen: 'justdb-telemetry-notice-seen',
} as const;

/** Event dispatched when an editor-affecting pref changes, so open editors
 *  can re-read it without a reload. */
export const EDITOR_SETTINGS_EVENT = 'justdb:editor-settings';

export const DEFAULT_ROW_CAP = 200;
export const DEFAULT_IDLE_MIN = 30;

function readNumber(key: string, def: number, min: number, max: number): number {
  try {
    const v = parseInt(localStorage.getItem(key) ?? '', 10);
    if (Number.isFinite(v) && v >= min && v <= max) return v;
  } catch {
    // ignore
  }
  return def;
}

function writeNumber(key: string, n: number) {
  try {
    localStorage.setItem(key, String(n));
  } catch {
    // ignore
  }
}

/** Max rows the SQL editor renders before truncating (10–5000). */
export const getResultRowCap = () => readNumber(KEYS.rowCap, DEFAULT_ROW_CAP, 10, 5000);
export const setResultRowCap = (n: number) => writeNumber(KEYS.rowCap, n);

/** Minutes of inactivity before auto-disconnect (1–1440). */
export const getIdleTimeoutMin = () => readNumber(KEYS.idleMin, DEFAULT_IDLE_MIN, 1, 1440);
export const setIdleTimeoutMin = (n: number) => writeNumber(KEYS.idleMin, n);

/** Show line numbers in the SQL editor (default off; only '1' enables). */
export const getEditorLineNumbers = (): boolean => {
  try {
    return localStorage.getItem(KEYS.lineNumbers) === '1';
  } catch {
    return false;
  }
};
export const setEditorLineNumbers = (on: boolean) => {
  try {
    localStorage.setItem(KEYS.lineNumbers, on ? '1' : '0');
  } catch {
    // ignore
  }
};

/** Anonymous usage analytics. Opt-out model: enabled unless explicitly
 *  turned off, so only a stored '0' disables it. */
export const getTelemetryEnabled = (): boolean => {
  try {
    return localStorage.getItem(KEYS.telemetry) !== '0';
  } catch {
    return true;
  }
};
export const setTelemetryEnabled = (on: boolean) => {
  try {
    localStorage.setItem(KEYS.telemetry, on ? '1' : '0');
  } catch {
    // ignore
  }
};

/** One-time first-run notice that anonymous analytics is on. */
export const getTelemetryNoticeSeen = (): boolean => {
  try {
    return localStorage.getItem(KEYS.telemetryNoticeSeen) === '1';
  } catch {
    return true;
  }
};
export const setTelemetryNoticeSeen = () => {
  try {
    localStorage.setItem(KEYS.telemetryNoticeSeen, '1');
  } catch {
    // ignore
  }
};

export type ExperienceMode = 'guided' | 'expert';
export function getExperienceMode(): ExperienceMode {
  try { return localStorage.getItem('justdb-experience-mode') === 'expert' ? 'expert' : 'guided'; }
  catch { return 'guided'; }
}
export function setExperienceMode(mode: ExperienceMode) {
  localStorage.setItem('justdb-experience-mode', mode);
  window.dispatchEvent(new Event(EDITOR_SETTINGS_EVENT));
}

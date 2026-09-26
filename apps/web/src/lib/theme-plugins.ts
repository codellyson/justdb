/** JustDB's fixed white and matte-black palettes. */
export type Mode = 'light' | 'dark';
export type Appearance = Mode | 'system';
export function parseAppearance(value: string | null): Appearance {
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function resolveMode(appearance: Appearance, systemDark: boolean): Mode {
  return appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance;
}
export interface ThemeVariant {
  /** Page background. */
  bg: string;
  /** Slightly elevated surface (cards, hover states). */
  bgSecondary: string;
  /** Border / divider color. */
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  /** Focal accent for active state, links, highlights. */
  accent: string;
  accentHover: string;
  /** Color for the accent-on-fill case (e.g., text on a solid accent button). */
  accentText: string;
  danger: string;
  success: string;
  warning: string;
}

export const PALETTES: Record<Mode, ThemeVariant> = {
  light: {
    bg: '255 255 255', bgSecondary: '247 247 247', border: '220 220 220',
    textPrimary: '18 18 18', textSecondary: '85 85 85', textMuted: '105 105 105',
    accent: '18 18 18', accentHover: '50 50 50', accentText: '255 255 255',
    danger: '185 28 28', success: '21 128 61', warning: '146 90 0',
  },
  dark: {
    bg: '18 18 18', bgSecondary: '26 26 26', border: '48 48 48',
    textPrimary: '250 250 250', textSecondary: '180 180 180', textMuted: '145 145 145',
    accent: '250 250 250', accentHover: '215 215 215', accentText: '18 18 18',
    danger: '248 113 113', success: '74 222 128', warning: '250 204 21',
  },
};
const VAR_MAP: Record<keyof ThemeVariant, string> = {
  bg: '--bg',
  bgSecondary: '--bg-secondary',
  border: '--border',
  textPrimary: '--text-primary',
  textSecondary: '--text-secondary',
  textMuted: '--text-muted',
  accent: '--accent',
  accentHover: '--accent-hover',
  // accentText is JS-only (used by codemirror theme); not a Tailwind token.
  accentText: '--accent-text',
  danger: '--danger',
  success: '--success',
  warning: '--warning',
};

export function applyThemeVariant(variant: ThemeVariant): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const key of Object.keys(VAR_MAP) as (keyof ThemeVariant)[]) {
    root.style.setProperty(VAR_MAP[key], variant[key]);
  }
}

import { describe, expect, it } from 'vitest';
import { PALETTES, parseAppearance, resolveMode } from './theme-plugins';

describe('appearance preferences', () => {
  it('preserves legacy explicit light and dark selections', () => {
    for (const mode of ['light', 'dark'] as const) {
      expect(parseAppearance(mode)).toBe(mode);
      expect(resolveMode(parseAppearance(mode), mode === 'light')).toBe(mode);
    }
  });
  it('defaults new or invalid preferences to system', () => {
    for (const value of [null, '', 'system', 'gruvbox', 'invalid']) {
      expect(parseAppearance(value)).toBe('system');
    }
  });
  it('follows OS changes only for system mode', () => {
    expect(resolveMode('system', false)).toBe('light');
    expect(resolveMode('system', true)).toBe('dark');
    expect(resolveMode('light', true)).toBe('light');
    expect(resolveMode('dark', false)).toBe('dark');
  });
  it('keeps text and filled-action labels at accessible contrast', () => {
    const luminance = (color: string) => color.split(' ').map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n,v,i) => n + v * [.2126,.7152,.0722][i], 0);
    for (const palette of Object.values(PALETTES)) {
      for (const [fg,bg] of [[palette.textPrimary,palette.bg],[palette.textMuted,palette.bg],[palette.accentText,palette.accent],[palette.accentText,palette.accentHover]]) {
        const a=luminance(fg), b=luminance(bg);
        expect((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

import React, { createContext, useContext, useState, useEffect, useLayoutEffect } from 'react';
import { PALETTES, applyThemeVariant, parseAppearance, resolveMode, type Appearance, type Mode } from '@/lib/theme-plugins';
import { isTauriRuntime } from '@/lib/runtime';

interface ThemeContextType {
  mode: Mode;
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
  toggleMode: () => void;
}
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
const MODE_KEY = 'dbview-mode';
function readAppearance(): Appearance {
  try { return parseAppearance(localStorage.getItem(MODE_KEY)); } catch { return 'system'; }
}
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Existing light/dark preferences survive removal of the named theme presets.
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const mode = resolveMode(appearance, systemDark);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setSystemDark(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    // A palette change should be one frame, not hundreds of color transitions.
    const suppression = document.createElement('style');
    suppression.textContent = '*,*::before,*::after{transition:none !important}';
    document.head.appendChild(suppression);
    root.classList.toggle('dark', mode === 'dark');
    root.style.colorScheme = mode;
    root.dataset.theme = 'justdb';
    applyThemeVariant(PALETTES[mode]);
    void root.offsetHeight;
    const frame = requestAnimationFrame(() => suppression.remove());
    return () => {
      cancelAnimationFrame(frame);
      suppression.remove();
    };
  }, [mode]);

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, appearance);
      localStorage.removeItem('dbview-theme');
    } catch { /* Appearance still works when storage is unavailable. */ }
  }, [appearance]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      if (cancelled) return;
      const win = getCurrentWindow();
      const [r, g, b] = PALETTES[mode].bg.split(' ').map(Number);
      await Promise.all([win.setTheme(mode), win.setBackgroundColor([r, g, b])]);
    })().catch(err => console.error('[theme] tauri sync failed:', err));
    return () => { cancelled = true; };
  }, [mode]);

  return <ThemeContext.Provider value={{ mode, appearance, setAppearance, toggleMode: () => setAppearance(mode === 'light' ? 'dark' : 'light') }}>{children}</ThemeContext.Provider>;
}
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
}

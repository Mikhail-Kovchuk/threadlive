'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import type { ThreadliveProps, ThreadliveTheme } from './types.js';

const THEME_VARIABLES = {
  accent: '--tl-accent',
  headerBg: '--tl-header-bg',
  fontFamily: '--tl-font',
  radius: '--tl-radius',
} as const satisfies Record<keyof ThreadliveTheme, `--tl-${string}`>;

/**
 * The chat widget.
 *
 * Renders nothing on the server and on the client's first render, and mounts
 * right after: a server-rendered page (Next.js) hydrates without a mismatch,
 * and nothing touches window or localStorage during SSR.
 */
export function Threadlive({ theme, hidden = false }: ThreadliveProps) {
  const mounted = useMounted();

  if (!mounted || hidden) {
    return null;
  }

  return <div className="tl-root" style={themeStyle(theme)} />;
}

function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted;
}

function themeStyle(theme: ThreadliveTheme | undefined): CSSProperties | undefined {
  if (!theme) {
    return undefined;
  }

  const style: Record<string, string> = {};

  for (const key of Object.keys(THEME_VARIABLES) as (keyof ThreadliveTheme)[]) {
    const value = theme[key];

    if (value !== undefined && value !== '') {
      style[THEME_VARIABLES[key]] = value;
    }
  }

  return style as CSSProperties;
}

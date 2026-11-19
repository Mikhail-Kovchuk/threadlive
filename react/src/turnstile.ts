import { useCallback, useEffect, useRef, useState } from 'react';

/** The part of Cloudflare's `window.turnstile` the widget uses. */
interface TurnstileApi {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      appearance?: 'always' | 'execute' | 'interaction-only';
      callback?: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    },
  ): string | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** How long a send waits for the check to finish before going without it. */
const WAIT_MS = 15_000;

let loading: Promise<TurnstileApi> | null = null;

/** Cloudflare's script, once per page — and only on a page where a guest is about to write. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);

  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load.')));
    script.onerror = () => {
      loading = null; // a later attempt may get through
      reject(new Error('Turnstile did not load.'));
    };
    document.head.appendChild(script);
  });

  return loading;
}

/**
 * Cloudflare Turnstile for a guest's first message. Mostly invisible: it
 * shows itself only when Cloudflare wants the visitor to click.
 *
 * `ref` goes on the element it renders into; `getToken()` gives a fresh
 * token (each is good for one message) — waiting for the check when it has
 * not finished yet, and giving up after a while: the backend then answers
 * with a sentence the visitor sees, and Retry asks again.
 */
export function useTurnstile(siteKey: string | null): {
  ref: (element: HTMLDivElement | null) => void;
  getToken: () => Promise<string | undefined>;
} {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const token = useRef<string | null>(null);
  const waiting = useRef<((token: string) => void)[]>([]);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);

  useEffect(() => {
    if (!siteKey || !element) return;

    let cancelled = false;

    loadTurnstile().then(
      (api) => {
        if (cancelled) return;
        const id = api.render(element, {
          sitekey: siteKey,
          appearance: 'interaction-only',
          callback: (value) => {
            const next = waiting.current.shift();
            if (next) {
              next(value);
              api.reset(id ?? '');
            } else {
              token.current = value;
            }
          },
          'expired-callback': () => {
            token.current = null;
          },
          'error-callback': () => {
            token.current = null;
          },
        });
        if (id) widget.current = { api, id };
      },
      () => {
        // Blocked (an ad blocker, a CSP): sends go without a token, and the
        // backend's sentence explains.
      },
    );

    return () => {
      cancelled = true;
      if (widget.current) {
        widget.current.api.remove(widget.current.id);
        widget.current = null;
      }
      token.current = null;
    };
  }, [siteKey, element]);

  const getToken = useCallback(async () => {
    if (!siteKey) return undefined;

    const ready = token.current;
    if (ready) {
      token.current = null;
      // Used up: start on the next one now.
      if (widget.current) widget.current.api.reset(widget.current.id);

      return ready;
    }

    return new Promise<string | undefined>((resolve) => {
      const take = (value: string) => {
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        waiting.current = waiting.current.filter((w) => w !== take);
        resolve(undefined);
      }, WAIT_MS);
      waiting.current.push(take);
    });
  }, [siteKey]);

  return { ref: setElement, getToken };
}

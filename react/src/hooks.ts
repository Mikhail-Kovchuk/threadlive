import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { chatReducer, initialChatState, uuid } from './chat.js';
import { ThreadliveRequestError } from './transport.js';
import type { ThreadliveTransport } from './types.js';

/** A ref that always holds the latest value: for callbacks read later, without re-subscribing. */
export function useLatest<T>(value: T): { current: T } {
  const ref = useRef(value);
  ref.current = value;

  return ref;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(query).matches);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }

    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);

    return () => list.removeEventListener('change', update);
  }, [query]);

  return matches;
}

export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => !document.hidden);

  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);

    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  return visible;
}

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;

/**
 * True once the visitor has not touched the page for `afterMs`: a tab left
 * open on a second screen, a laptop walked away from. Any input, or the tab
 * becoming visible again, ends it.
 */
export function useIdle(afterMs: number): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastSeen = 0;

    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), afterMs);
    };

    const onActivity = () => {
      // pointermove and scroll fire constantly; once a second is plenty.
      const now = Date.now();
      if (now - lastSeen < 1000) return;
      lastSeen = now;
      setIdle(false);
      arm();
    };

    const onVisibility = () => {
      if (!document.hidden) onActivity();
    };

    arm();
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, onActivity, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearTimeout(timer);
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, onActivity, { capture: true });
      }
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [afterMs]);

  return idle;
}

/**
 * A reply the visitor cannot see right now: "(1) Page title" while the tab
 * is hidden, and a soft chime when it arrives with the tab hidden or the
 * panel closed. Unread replies already there on page load make no sound.
 */
export function useAttention(
  unread: number,
  open: boolean,
  visible: boolean,
  ready: boolean,
  options: { title: boolean; sound: boolean },
): void {
  const previous = useRef<number | null>(null);
  const originalTitle = useRef<string | null>(null);

  useEffect(() => {
    if (!options.title) return;

    if (!visible && unread > 0) {
      originalTitle.current ??= document.title;
      document.title = `(${unread}) ${originalTitle.current}`;
    } else if (originalTitle.current !== null) {
      document.title = originalTitle.current;
      originalTitle.current = null;
    }
  }, [unread, visible, options.title]);

  useEffect(
    () => () => {
      if (originalTitle.current !== null) document.title = originalTitle.current;
    },
    [],
  );

  useEffect(() => {
    if (!ready) return;

    const before = previous.current;
    previous.current = unread;

    if (before !== null && unread > before && options.sound && (!visible || !open)) {
      chime();
    }
  }, [unread, visible, open, ready, options.sound]);
}

/** Two quiet notes, synthesised: no file to ship, nothing to load. */
function chime(): void {
  try {
    const Context =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;

    const context = new Context();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.setValueAtTime(1320, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.42);
    oscillator.onended = () => void context.close();
  } catch {
    // No sound (no audio, or the browser wants a gesture first): the title still tells.
  }
}

const MAX_BACKOFF_MS = 60_000;

interface UseChatOptions {
  transport: ThreadliveTransport;
  open: boolean;
  visible: boolean;
  getContext: { current: (() => Record<string, unknown>) | undefined };
  /** Cloudflare Turnstile's token, asked for while there is no conversation yet. */
  getTurnstileToken?: () => Promise<string | undefined>;
}

/**
 * The conversation: bootstrap, polling, optimistic sends, read receipts.
 *
 * Polling costs the host a request each time, so it runs only when a reply
 * could matter:
 *
 *   no conversation                             → never
 *   tab hidden, visitor awaiting a reply        → every poll_ms.closed, until idle (the
 *                                                 tab title and a sound tell them it came)
 *   tab hidden, otherwise                       → never
 *   panel closed, conversation not live         → never (next page load shows replies)
 *   panel closed, visitor idle                  → never (input resumes it at once)
 *   panel closed, live conversation             → every poll_ms.closed, for the badge
 *   panel open                                  → every poll_ms.open (poll_ms.idle when idle)
 *
 * with exponential backoff after a failure. "Awaiting a reply": the visitor
 * wrote last (status waiting). Idle: no input for poll_ms.idle_after — in a
 * hidden tab that is simply time since they left it.
 */
export function useChat({ transport, open, visible, getContext, getTurnstileToken }: UseChatOptions) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const latest = useLatest(state);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    transport.bootstrap().then(
      (bootstrap) => !cancelled && dispatch({ type: 'bootstrapped', bootstrap }),
      () => !cancelled && dispatch({ type: 'bootstrapFailed' }),
    );

    return () => {
      cancelled = true;
    };
  }, [transport, attempt]);

  const retryBootstrap = useCallback(() => {
    dispatch({ type: 'bootstrapRetry' });
    setAttempt((n) => n + 1);
  }, []);

  const ready = state.phase === 'ready' && state.bootstrap?.enabled === true;
  const hasConversation = state.conversation !== null;
  const live = state.conversation?.active === true;
  const awaitingReply = state.conversation?.status === 'waiting';
  const poll = state.bootstrap?.poll_ms;
  const pollOpen = poll?.open ?? 3000;
  const pollClosed = poll?.closed ?? 30000;
  const pollIdle = poll?.idle ?? 15000;
  const idle = useIdle(poll?.idle_after ?? 300000);

  useEffect(() => {
    if (!ready || !hasConversation) {
      return;
    }

    // Hidden tab: only for the reply the visitor is waiting for, while they
    // may still be around to come back to it.
    if (!visible && (!awaitingReply || idle)) {
      return;
    }

    // Panel closed: only for a reply that may still come, to someone around to see it.
    if (visible && !open && (!live || idle)) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let failures = 0;

    const lastId = () => {
      const { messages, historyLoaded } = latest.current;

      return historyLoaded ? (messages[messages.length - 1]?.id ?? null) : null;
    };

    const schedule = () => {
      clearTimeout(timer);
      const base = visible && open ? (idle ? pollIdle : pollOpen) : pollClosed;
      timer = setTimeout(() => void tick(), failures === 0 ? base : Math.min(base * 2 ** failures, MAX_BACKOFF_MS));
    };

    const tick = async () => {
      if (inFlight) {
        return;
      }

      inFlight = true;
      try {
        const result = await transport.messages(lastId());
        if (cancelled) return;
        failures = 0;
        dispatch({ type: 'received', ...result });
      } catch {
        if (cancelled) return;
        failures += 1;
        dispatch({ type: 'pollFailed' });
      } finally {
        inFlight = false;
      }

      if (!cancelled) {
        schedule();
      }
    };

    // Whatever (re)started polling — opening the panel, the tab coming back,
    // coming back from idle, a first load — deserves an answer now, not a
    // cycle later.
    void tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, hasConversation, live, awaitingReply, idle, open, visible, transport, pollOpen, pollClosed, pollIdle, latest]);

  // Read receipts: whatever the visitor can see is read.
  const lastAgentId = findLast(state.messages, (m) => m.direction === 'agent')?.id ?? null;
  const readUpTo = useRef(0);

  useEffect(() => {
    if (!open || !visible || lastAgentId === null || readUpTo.current >= lastAgentId) {
      return;
    }

    readUpTo.current = lastAgentId;
    dispatch({ type: 'read' });
    transport.markRead(lastAgentId).catch(() => {
      // The next poll still reports it unread; the next look marks it again.
      readUpTo.current = 0;
    });
  }, [open, visible, lastAgentId, transport]);

  const deliver = useCallback(
    async (body: string, clientMsgId: string, files: File[]) => {
      try {
        const context = {
          url: window.location.href,
          title: document.title,
          attributes: getContext.current?.() ?? {},
        };
        const turnstileToken =
          latest.current.conversation === null && getTurnstileToken ? await getTurnstileToken() : undefined;
        const result = await transport.send({
          body,
          client_msg_id: clientMsgId,
          context,
          ...(files.length > 0 ? { files } : {}),
          ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
        });
        dispatch({ type: 'sent', clientMsgId, ...result });
      } catch (error) {
        // A 4xx message is written for visitors (e.g. "The message may not be
        // longer than 2000 characters."); anything else is just "Not sent".
        const shown =
          error instanceof ThreadliveRequestError && error.status >= 400 && error.status < 500 && error.status !== 404
            ? error.message
            : undefined;
        dispatch({ type: 'sendFailed', clientMsgId, error: shown });
      }
    },
    [transport, getContext, getTurnstileToken, latest],
  );

  const send = useCallback(
    (body: string, files: File[] = []) => {
      const clientMsgId = uuid();
      dispatch({
        type: 'queued',
        pending: { client_msg_id: clientMsgId, body, created_at: new Date().toISOString(), state: 'sending', files },
      });
      void deliver(body, clientMsgId, files);
    },
    [deliver],
  );

  /** The same client_msg_id, so a send that did arrive is not stored twice. */
  const retry = useCallback(
    (clientMsgId: string) => {
      const pending = latest.current.pending.find((p) => p.client_msg_id === clientMsgId);
      if (!pending) return;
      dispatch({ type: 'resending', clientMsgId });
      void deliver(pending.body, clientMsgId, pending.files ?? []);
    },
    [deliver, latest],
  );

  const saveEmail = useCallback(
    async (email: string) => {
      await transport.saveEmail(email);
      dispatch({ type: 'emailSaved', email });
    },
    [transport],
  );

  const unread = open && visible ? 0 : (state.conversation?.unread ?? 0);

  return { state, unread, lastAgentId, send, retry, saveEmail, retryBootstrap };
}

export function findLast<T>(items: readonly T[], test: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i] as T;
    if (test(item)) return item;
  }

  return undefined;
}

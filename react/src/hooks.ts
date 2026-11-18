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

const MAX_BACKOFF_MS = 60_000;

interface UseChatOptions {
  transport: ThreadliveTransport;
  open: boolean;
  visible: boolean;
  getContext: { current: (() => Record<string, unknown>) | undefined };
}

/**
 * The conversation: bootstrap, polling, optimistic sends, read receipts.
 *
 * Polling costs the host a request each time, so it runs only when a reply
 * could matter:
 *
 *   tab hidden                                  → never
 *   no conversation                             → never
 *   panel closed, conversation not live         → never (next page load shows replies)
 *   panel closed, visitor idle                  → never (input resumes it at once)
 *   panel closed, live conversation             → every poll_ms.closed, for the badge
 *   panel open                                  → every poll_ms.open (poll_ms.idle when idle)
 *
 * with exponential backoff after a failure.
 */
export function useChat({ transport, open, visible, getContext }: UseChatOptions) {
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
  const poll = state.bootstrap?.poll_ms;
  const pollOpen = poll?.open ?? 3000;
  const pollClosed = poll?.closed ?? 30000;
  const pollIdle = poll?.idle ?? 15000;
  const idle = useIdle(poll?.idle_after ?? 300000);

  useEffect(() => {
    if (!ready || !hasConversation) {
      return;
    }

    // Panel closed: only for a reply that may still come, to someone around to see it.
    if (!open && (!live || idle)) {
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
      const base = open ? (idle ? pollIdle : pollOpen) : pollClosed;
      timer = setTimeout(() => void tick(), failures === 0 ? base : Math.min(base * 2 ** failures, MAX_BACKOFF_MS));
    };

    const tick = async () => {
      // Hidden tab: stop here; becoming visible starts the next tick.
      if (document.hidden || inFlight) {
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

    const onVisibility = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void tick();
      }
    };

    // Whatever (re)started polling — opening the panel, coming back from
    // idle, a first load — deserves an answer now, not a cycle later.
    void tick();

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ready, hasConversation, live, idle, open, transport, pollOpen, pollClosed, pollIdle, latest]);

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
    async (body: string, clientMsgId: string) => {
      try {
        const context = {
          url: window.location.href,
          title: document.title,
          attributes: getContext.current?.() ?? {},
        };
        const result = await transport.send({ body, client_msg_id: clientMsgId, context });
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
    [transport, getContext],
  );

  const send = useCallback(
    (body: string) => {
      const clientMsgId = uuid();
      dispatch({
        type: 'queued',
        pending: { client_msg_id: clientMsgId, body, created_at: new Date().toISOString(), state: 'sending' },
      });
      void deliver(body, clientMsgId);
    },
    [deliver],
  );

  /** The same client_msg_id, so a send that did arrive is not stored twice. */
  const retry = useCallback(
    (clientMsgId: string) => {
      const pending = latest.current.pending.find((p) => p.client_msg_id === clientMsgId);
      if (!pending) return;
      dispatch({ type: 'resending', clientMsgId });
      void deliver(pending.body, clientMsgId);
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

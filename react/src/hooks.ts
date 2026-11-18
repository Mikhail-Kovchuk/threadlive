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
 * Polling runs only once there is a conversation: every `poll_ms.open` while
 * the panel is open, `poll_ms.closed` while it is closed (for the badge),
 * not at all while the tab is hidden, and with exponential backoff after a
 * failure.
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
  const pollOpen = state.bootstrap?.poll_ms.open ?? 3000;
  const pollClosed = state.bootstrap?.poll_ms.closed ?? 30000;

  useEffect(() => {
    if (!ready || !hasConversation) {
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
      const base = open ? pollOpen : pollClosed;
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

    // Opening the panel, or a history not loaded yet, should not wait a cycle.
    if (open || !latest.current.historyLoaded) {
      void tick();
    } else {
      schedule();
    }

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ready, hasConversation, open, transport, pollOpen, pollClosed, latest]);

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

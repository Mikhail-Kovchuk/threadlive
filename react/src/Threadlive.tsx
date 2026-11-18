'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { findLast, useChat, useDocumentVisible, useLatest, useMediaQuery } from './hooks.js';
import { Composer, EmailCard, Header, Launcher, MessageList, Preview, Welcome, agentLabel } from './parts.js';
import { DEFAULT_TEXTS } from './texts.js';
import { createHttpTransport } from './transport.js';
import type { ThreadliveHandle, ThreadliveProps, ThreadliveTheme } from './types.js';

const THEME_VARIABLES = {
  accent: '--tl-accent',
  headerBg: '--tl-header-bg',
  fontFamily: '--tl-font',
  radius: '--tl-radius',
  offsetX: '--tl-offset-x',
  offsetY: '--tl-offset-y',
} as const satisfies Record<keyof ThreadliveTheme, `--tl-${string}`>;

/** Must match the breakpoint in styles.css. */
const PHONE_QUERY = '(max-width: 480px)';

/**
 * The chat widget: a launcher fixed in a corner of the screen and the panel
 * it opens — full screen on phones.
 *
 * Renders nothing on the server and on the client's first render, and mounts
 * right after: a server-rendered page (Next.js) hydrates without a mismatch,
 * and nothing touches window or localStorage during SSR.
 */
export const Threadlive = forwardRef<ThreadliveHandle, ThreadliveProps>(function Threadlive(props, ref) {
  const mounted = useMounted();

  if (!mounted || props.hidden) {
    return null;
  }

  return <Widget {...props} ref={ref} />;
});

const Widget = forwardRef<ThreadliveHandle, ThreadliveProps>(function Widget(props, ref) {
  const { theme, position = 'right', logo, agents = [], topics = [], fallbackUrl } = props;
  const texts = { ...DEFAULT_TEXTS, ...props.texts };

  // Read through refs: an inline function from the host must not rebuild the
  // transport, or restart polling, on every render of the host.
  const getAuthHeaders = useLatest(props.getAuthHeaders);
  const getContext = useLatest(props.getContext);
  const onUnreadChange = useLatest(props.onUnreadChange);

  const transport = useMemo(
    () =>
      props.transport ??
      createHttpTransport({
        apiUrl: props.apiUrl ?? '',
        getAuthHeaders: () => getAuthHeaders.current?.() ?? {},
      }),
    [props.transport, props.apiUrl, getAuthHeaders],
  );

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [dismissedPreview, setDismissedPreview] = useState<number | null>(null);
  const isPhone = useMediaQuery(PHONE_QUERY);
  const visible = useDocumentVisible();
  const chat = useChat({ transport, open, visible, getContext });
  const { state, unread } = chat;

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelId = useId();

  const openPanel = useCallback(() => setOpen(true), []);
  const closePanel = useCallback(() => setOpen(false), []);

  useImperativeHandle(ref, () => ({ open: openPanel, close: closePanel }), [openPanel, closePanel]);

  useEffect(() => {
    onUnreadChange.current?.(unread);
  }, [unread, onUnreadChange]);

  // Opening a widget that failed to load tries again.
  useEffect(() => {
    if (open && state.phase === 'error' && !state.retrying) {
      chat.retryBootstrap();
    }
    // Only on opening; the error screen has its own button after that.
  }, [open]);

  // Focus: into the panel on opening, back to the launcher on closing when it
  // was inside the widget (not when the host closed it from elsewhere).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      (inputRef.current ?? panelRef.current)?.focus();
    } else if (wasOpen.current) {
      const active = document.activeElement;
      if (!active || active === document.body || rootRef.current?.contains(active)) {
        launcherRef.current?.focus();
      }
    }
    wasOpen.current = open;
  }, [open]);

  // Full screen on a phone: the page underneath must not scroll.
  useEffect(() => {
    if (!open || !isPhone) return;
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = 'hidden';

    return () => {
      html.style.overflow = previous;
    };
  }, [open, isPhone]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      closePanel();
      return;
    }

    // A full-screen panel is a modal: Tab cycles inside it. On wider screens
    // the panel sits beside the page, and the page stays reachable.
    if (event.key === 'Tab' && open && isPhone && panelRef.current) {
      trapTab(event, panelRef.current);
    }
  };

  const bootstrap = state.bootstrap;
  const showWidget = (state.phase === 'ready' && bootstrap?.enabled === true) || (state.phase === 'error' && !!fallbackUrl);

  if (!showWidget) {
    return null;
  }

  const agentName = bootstrap?.agent_display_name ?? texts.title;
  const lastAgent = findLast(state.messages, (m) => m.direction === 'agent');
  const preview =
    !open && unread > 0 && lastAgent && lastAgent.id !== dismissedPreview ? lastAgent : null;

  return (
    <div
      ref={rootRef}
      className="tl-root"
      data-position={position}
      data-open={open ? 'true' : 'false'}
      style={themeStyle(theme)}
      onKeyDown={onKeyDown}
    >
      {open && (
        <section
          ref={panelRef}
          id={panelId}
          className="tl-panel"
          role="dialog"
          aria-modal={isPhone || undefined}
          aria-label={texts.title}
          tabIndex={-1}
        >
          <Header
            texts={texts}
            logo={logo}
            online={bootstrap ? bootstrap.online : null}
            hours={bootstrap?.hours ?? null}
            fallbackUrl={fallbackUrl}
            onClose={closePanel}
          />

          {state.phase !== 'ready' || !bootstrap ? (
            <div className="tl-body tl-center">
              {state.retrying ? (
                <p className="tl-muted">{texts.loading}</p>
              ) : (
                <>
                  <p className="tl-muted">{texts.loadFailed}</p>
                  <button type="button" className="tl-button" onClick={chat.retryBootstrap}>
                    {texts.tryAgain}
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              {state.reconnecting && (
                <p className="tl-banner" role="status">
                  {texts.reconnecting}
                </p>
              )}

              {state.conversation === null && state.messages.length === 0 && state.pending.length === 0 ? (
                <div className="tl-body">
                  <Welcome
                    texts={texts}
                    hours={bootstrap.hours}
                    agents={agents}
                    topics={topics}
                    onTopic={bootstrap.can_write ? chat.send : null}
                  />
                </div>
              ) : (
                <MessageList
                  messages={state.messages}
                  pending={state.pending}
                  texts={texts}
                  agentDisplayName={agentName}
                  onRetry={chat.retry}
                >
                  {state.conversation?.status === 'closed' && <p className="tl-system">{texts.closedNote}</p>}
                  {!bootstrap.online &&
                    (state.pending.length > 0 || state.messages.some((m) => m.direction === 'visitor')) && (
                      <EmailCard
                        texts={texts}
                        hours={bootstrap.hours}
                        savedEmail={state.conversation?.email ?? null}
                        onSave={chat.saveEmail}
                      />
                    )}
                </MessageList>
              )}

              <Composer
                ref={inputRef}
                texts={texts}
                draft={draft}
                onDraft={setDraft}
                onSend={chat.send}
                canWrite={bootstrap.can_write}
                maxLength={bootstrap.max_message_length}
              />
            </>
          )}
        </section>
      )}

      {preview && (
        <Preview
          message={preview}
          label={agentLabel(preview.author, agentName)}
          texts={texts}
          onOpen={openPanel}
          onDismiss={() => setDismissedPreview(preview.id)}
        />
      )}

      <Launcher
        ref={launcherRef}
        open={open}
        unread={unread}
        panelId={panelId}
        texts={texts}
        onClick={open ? closePanel : openPanel}
      />
    </div>
  );
});

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

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapTab(event: KeyboardEvent, container: HTMLElement): void {
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

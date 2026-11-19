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
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { checkFiles } from './attachments.js';
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
  const { theme, position = 'right', logo, agents = [], fallbackUrl } = props;
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
  // 'home': the first screen (greeting, topics, "Continue the conversation");
  // 'chat': the conversation.
  const [view, setView] = useState<'home' | 'chat'>('chat');
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [dismissedPreview, setDismissedPreview] = useState<number | null>(null);
  const isPhone = useMediaQuery(PHONE_QUERY);
  const visible = useDocumentVisible();
  const chat = useChat({ transport, open, visible, getContext });
  const { state, unread } = chat;
  const latestConversation = useLatest(state.conversation);

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
  // On opening: a conversation going on opens itself; a closed one (or
  // none) opens on the first screen — a question a week later starts fresh,
  // with the history one tap away.
  useEffect(() => {
    if (open) {
      const conversation = latestConversation.current;
      setView(conversation !== null && conversation.status !== 'closed' ? 'chat' : 'home');
    }
  }, [open]);

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
  const attachmentRules = bootstrap?.attachments?.enabled && bootstrap.can_write ? bootstrap.attachments : null;

  const addFiles = (incoming: File[]) => {
    if (!attachmentRules || incoming.length === 0) return;
    const checked = checkFiles(files, incoming, attachmentRules, texts);
    setFiles(checked.files);
    setFileErrors(checked.errors);
  };

  // Whatever is sent — from the field or a topic — continues in the chat.
  const sendMessage = (body: string, toSend: File[] = []) => {
    chat.send(body, toSend);
    setFiles([]);
    setFileErrors([]);
    setView('chat');
  };

  // The header's link out: the page's prop, else the server's config.
  const fallbackLink = fallbackUrl ?? bootstrap?.fallback?.url;
  const headerTexts =
    props.texts?.continueElsewhere === undefined && bootstrap?.fallback?.label
      ? { ...texts, continueElsewhere: bootstrap.fallback.label }
      : texts;

  const hasHistory = state.conversation !== null || state.messages.length > 0 || state.pending.length > 0;
  const showHome = !hasHistory || view === 'home';
  const lastMessage = findLast(state.messages, (m) => m.direction === 'agent' || m.direction === 'visitor');

  // Files dropped anywhere on the panel.
  const dropHandlers = attachmentRules
    ? {
        onDragOver: (event: DragEvent<HTMLElement>) => {
          if (Array.from(event.dataTransfer.types).includes('Files')) {
            event.preventDefault();
            setDragging(true);
          }
        },
        onDragLeave: (event: DragEvent<HTMLElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        },
        onDrop: (event: DragEvent<HTMLElement>) => {
          event.preventDefault();
          setDragging(false);
          addFiles(Array.from(event.dataTransfer.files));
        },
      }
    : {};
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
          data-dragging={dragging ? 'true' : undefined}
          {...dropHandlers}
        >
          {dragging && (
            <div className="tl-drop" aria-hidden="true">
              {texts.dropFiles}
            </div>
          )}
          <Header
            texts={headerTexts}
            logo={logo}
            online={bootstrap ? bootstrap.online : null}
            hours={bootstrap?.hours ?? null}
            fallbackUrl={fallbackLink}
            onClose={closePanel}
            onHome={hasHistory && !showHome ? () => setView('home') : null}
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

              {showHome ? (
                <div className="tl-body">
                  <Welcome
                    texts={texts}
                    hours={bootstrap.hours}
                    agents={agents}
                    topics={props.topics ?? bootstrap.topics ?? []}
                    onTopic={bootstrap.can_write ? (topic) => sendMessage(topic) : null}
                    onContinue={hasHistory ? () => setView('chat') : null}
                    last={
                      lastMessage
                        ? {
                            label: lastMessage.direction === 'visitor' ? texts.you : (lastMessage.author ?? agentName),
                            body: lastMessage.body !== '' ? lastMessage.body : texts.aFile,
                            at: lastMessage.created_at,
                          }
                        : null
                    }
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
                onSend={sendMessage}
                canWrite={bootstrap.can_write}
                maxLength={bootstrap.max_message_length}
                attachments={attachmentRules}
                files={files}
                fileErrors={fileErrors}
                onAddFiles={addFiles}
                onRemoveFile={(index) => {
                  setFiles((current) => current.filter((_, i) => i !== index));
                  setFileErrors([]);
                }}
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

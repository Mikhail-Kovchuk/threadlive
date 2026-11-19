import {
  forwardRef,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { DraftFile, MessageFiles } from './attachments.js';
import type { PendingMessage } from './chat.js';
import {
  ChatIcon,
  ClipboardIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  HomeIcon,
  ChevronLeftIcon,
  ClockIcon,
  CloseIcon,
  DeliveredIcon,
  PaperclipIcon,
  PlaneIcon,
  SendIcon,
} from './icons.js';
import { format } from './texts.js';
import type { AttachmentRules, ChatMessage, SupportHours, ThreadliveTexts } from './types.js';

// --- Small helpers --------------------------------------------------------------

export function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

/** One of four avatar colours, the same for the same name. */
function tone(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;

  return Math.abs(hash) % 4;
}

function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span className={large ? 'tl-avatar tl-avatar-lg' : 'tl-avatar'} data-tone={tone(name)} aria-hidden="true">
      {initial(name)}
    </span>
  );
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dayOf(iso: string): string {
  const date = new Date(iso);

  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(iso: string, texts: ThreadliveTexts): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);

  if (dayOf(iso) === dayOf(today.toISOString())) return texts.today;
  if (dayOf(iso) === dayOf(yesterday.toISOString())) return texts.yesterday;

  return date.toLocaleDateString([], { day: 'numeric', month: 'long' });
}

export function agentLabel(author: string | null | undefined, displayName: string): string {
  return author ? `${author} · ${displayName}` : displayName;
}

/** Longer than this (characters, or lines as written), a message starts collapsed. */
const LONG_CHARS = 700;
const LONG_LINES = 12;

export function isLong(body: string): boolean {
  return body.length > LONG_CHARS || body.split('\n').length > LONG_LINES;
}

/**
 * A message's text. A long one — a pasted log, a whole policy — shows its
 * first lines and "Show more", so it does not push the conversation away.
 */
function Bubble({ body, texts, prefix }: { body: string; texts: ThreadliveTexts; prefix?: ReactNode }) {
  const long = isLong(body);
  const [expanded, setExpanded] = useState(false);
  const id = useId();

  return (
    <div className="tl-bubble">
      {prefix}
      <div id={id} className={long && !expanded ? 'tl-bubble-text tl-clamped' : 'tl-bubble-text'}>
        {body}
      </div>
      {long && (
        <button
          type="button"
          className="tl-more"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? texts.showLess : texts.showMore}
        </button>
      )}
    </div>
  );
}

// --- Launcher ---------------------------------------------------------------------

interface LauncherProps {
  open: boolean;
  unread: number;
  panelId: string;
  texts: ThreadliveTexts;
  onClick: () => void;
  variant: 'pill' | 'icon';
  icon?: ReactNode;
}

/**
 * A pill on wide screens and a round button on phones (CSS), or round
 * everywhere ('icon'); the close button while open.
 */
export const Launcher = forwardRef<HTMLButtonElement, LauncherProps>(function Launcher(
  { open, unread, panelId, texts, onClick, variant, icon },
  ref,
) {
  const label = open ? texts.close : unread > 0 ? format(texts.openWithUnread, { count: unread }) : texts.open;

  return (
    <button
      ref={ref}
      type="button"
      className="tl-launcher"
      data-open={open ? 'true' : 'false'}
      data-variant={variant}
      aria-label={label}
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      onClick={onClick}
    >
      {open ? (
        <CloseIcon />
      ) : (
        <>
          <span className="tl-launcher-icon" aria-hidden="true">
            {icon ?? <ChatIcon />}
          </span>
          {variant === 'pill' && <span className="tl-launcher-label">{texts.launcher}</span>}
        </>
      )}
      {!open && unread > 0 && (
        <span className="tl-badge" aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );
});

interface PreviewProps {
  message: ChatMessage;
  label: string;
  texts: ThreadliveTexts;
  onOpen: () => void;
  onDismiss: () => void;
}

/** The latest unread reply, above the launcher while the panel is closed. */
export function Preview({ message, label, texts, onOpen, onDismiss }: PreviewProps) {
  return (
    <div className="tl-preview">
      <button type="button" className="tl-preview-main" onClick={onOpen}>
        <Avatar name={message.author ?? label} large />
        <span className="tl-preview-text">
          <span className="tl-preview-author">{label}</span>
          <span className="tl-preview-body">{message.body !== '' ? message.body : texts.aFile}</span>
        </span>
      </button>
      <button type="button" className="tl-icon-btn tl-preview-close" aria-label={texts.dismissPreview} onClick={onDismiss}>
        <CloseIcon size={16} />
      </button>
    </div>
  );
}

// --- Header -------------------------------------------------------------------------

interface HeaderProps {
  texts: ThreadliveTexts;
  logo?: ReactNode;
  online: boolean | null;
  hours: SupportHours | null;
  fallbackUrl?: string;
  onClose: () => void;
  /** Back to the first screen; null when already there (or there is nothing else). */
  onHome: (() => void) | null;
}

export function Header({ texts, logo, online, hours, fallbackUrl, onClose, onHome }: HeaderProps) {
  const status =
    online === null
      ? null
      : online
        ? texts.replyTime
          ? `${texts.online} · ${texts.replyTime}`
          : texts.online
        : format(texts.away, { time: hours?.from ?? '' });

  return (
    <header className="tl-header">
      {/* Phones: the panel fills the screen, so "back" leads out of it. */}
      <button type="button" className="tl-icon-btn tl-back" aria-label={texts.close} onClick={onClose}>
        <ChevronLeftIcon />
      </button>
      <span className="tl-logo" aria-hidden="true">
        {logo ?? initial(texts.title)}
      </span>
      <div className="tl-heading">
        <h2 className="tl-title">{texts.title}</h2>
        {status !== null && (
          <p className="tl-status">
            <span className="tl-dot" data-online={online ? 'true' : 'false'} aria-hidden="true" />
            {status}
          </p>
        )}
      </div>
      {onHome && (
        <button type="button" className="tl-icon-btn" aria-label={texts.home} title={texts.home} onClick={onHome}>
          <HomeIcon />
        </button>
      )}
      {fallbackUrl && (
        <a
          className="tl-icon-btn"
          href={fallbackUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={texts.continueElsewhere}
          title={texts.continueElsewhere}
        >
          <PlaneIcon />
        </a>
      )}
      <button type="button" className="tl-icon-btn tl-minimise" aria-label={texts.minimise} onClick={onClose}>
        <ChevronDownIcon />
      </button>
    </header>
  );
}

// --- First screen ---------------------------------------------------------------

interface WelcomeProps {
  texts: ThreadliveTexts;
  hours: SupportHours;
  agents: string[];
  topics: string[];
  onTopic: ((topic: string) => void) | null;
  /** The conversation there already is: its last message, and the way back to it. */
  last?: { label: string; body: string; at: string } | null;
  onContinue?: (() => void) | null;
}

export function Welcome({ texts, hours, agents, topics, onTopic, last = null, onContinue = null }: WelcomeProps) {
  return (
    <div className="tl-welcome">
      <div className="tl-welcome-intro">
        <p className="tl-greeting">{texts.greeting}</p>
        <p className="tl-intro">{texts.intro}</p>
      </div>

      {onContinue && (
        <button type="button" className="tl-continue" onClick={onContinue}>
          <span className="tl-continue-text">
            <span className="tl-continue-title">💬 {texts.continueConversation}</span>
            {last && (
              <span className="tl-continue-last">
                {last.label}: {last.body} · {timeOf(last.at)}
              </span>
            )}
          </span>
          <ChevronRightIcon />
        </button>
      )}

      <div className="tl-team">
        {agents.length > 0 && (
          <span className="tl-team-avatars">
            {agents.slice(0, 3).map((name) => (
              <Avatar key={name} name={name} />
            ))}
          </span>
        )}
        <span>{format(texts.hours, { from: hours.from, to: hours.to })}</span>
      </div>

      {onTopic && topics.length > 0 && (
        <div className="tl-topics">
          <p className="tl-topics-title">{texts.topicsTitle}</p>
          <div className="tl-topics-grid">
            {topics.map((topic) => (
              <button key={topic} type="button" className="tl-topic" onClick={() => onTopic(topic)}>
                {topic}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Messages ---------------------------------------------------------------------

interface MessageListProps {
  messages: ChatMessage[];
  pending: PendingMessage[];
  texts: ThreadliveTexts;
  agentDisplayName: string;
  onRetry: (clientMsgId: string) => void;
  /** Below the messages: the closed note, the e-mail card. */
  children?: ReactNode;
}

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: ChatMessage }
  | { kind: 'pending'; key: string; pending: PendingMessage };

export function MessageList({ messages, pending, texts, agentDisplayName, onRetry, children }: MessageListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  // Follow new messages only while the visitor is at the bottom: someone
  // reading further up is not yanked away. Their own send always follows.
  const atBottom = useRef(true);
  const pendingCount = useRef(pending.length);

  useLayoutEffect(() => {
    const list = listRef.current;
    const ownSend = pending.length > pendingCount.current;
    pendingCount.current = pending.length;

    if (list && (atBottom.current || ownSend)) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages, pending, children]);

  const rows: Row[] = [];
  let lastDay: string | null = null;
  const addDay = (iso: string) => {
    const day = dayOf(iso);
    if (day !== lastDay) {
      rows.push({ kind: 'day', key: `day-${day}`, label: dayLabel(iso, texts) });
      lastDay = day;
    }
  };

  for (const message of messages) {
    addDay(message.created_at);
    rows.push({ kind: 'message', key: `m-${message.id}`, message });
  }
  for (const item of pending) {
    addDay(item.created_at);
    rows.push({ kind: 'pending', key: `p-${item.client_msg_id}`, pending: item });
  }

  return (
    <div
      ref={listRef}
      className="tl-body tl-log"
      role="log"
      aria-live="polite"
      aria-label={texts.messages}
      onScroll={(event) => {
        const el = event.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      {rows.map((row) => {
        if (row.kind === 'day') {
          return (
            <div key={row.key} className="tl-day">
              {row.label}
            </div>
          );
        }

        if (row.kind === 'pending') {
          const { pending: item } = row;

          return (
            <div key={row.key} className="tl-msg tl-msg-visitor">
              <MessageFiles files={item.files} />
              {item.body !== '' && (
                <Bubble body={item.body} texts={texts} prefix={<span className="tl-sr-only">{texts.you}: </span>} />
              )}
              <div className="tl-meta">
                {timeOf(item.created_at)}
                {item.state === 'sending' ? (
                  <span> · {texts.sending}</span>
                ) : (
                  <>
                    <span className="tl-error"> · {item.error ?? texts.notSent}</span>
                    <button type="button" className="tl-link-btn" onClick={() => onRetry(item.client_msg_id)}>
                      {texts.retry}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        }

        const { message } = row;

        if (message.direction === 'context') {
          return (
            <div key={row.key} className="tl-context">
              <ClipboardIcon />
              <span>{message.body}</span>
            </div>
          );
        }

        if (message.direction === 'system') {
          return (
            <div key={row.key} className="tl-system">
              {message.body}
            </div>
          );
        }

        if (message.direction === 'visitor') {
          return (
            <div key={row.key} className="tl-msg tl-msg-visitor">
              <MessageFiles attachments={message.attachments} />
              {message.body !== '' && (
                <Bubble body={message.body} texts={texts} prefix={<span className="tl-sr-only">{texts.you}: </span>} />
              )}
              <div className="tl-meta">
                {timeOf(message.created_at)}
                <DeliveredIcon />
                <span>{texts.delivered}</span>
              </div>
            </div>
          );
        }

        const label = agentLabel(message.author, agentDisplayName);

        return (
          <div key={row.key} className="tl-msg tl-msg-agent">
            <Avatar name={message.author ?? agentDisplayName} />
            <div className="tl-msg-column">
              <div className="tl-author">{label}</div>
              <MessageFiles attachments={message.attachments} />
              {message.body !== '' && <Bubble body={message.body} texts={texts} />}
              <div className="tl-meta">{timeOf(message.created_at)}</div>
            </div>
          </div>
        );
      })}
      {children}
    </div>
  );
}

// --- Offline e-mail ------------------------------------------------------------

interface EmailCardProps {
  texts: ThreadliveTexts;
  hours: SupportHours;
  savedEmail: string | null;
  onSave: (email: string) => Promise<void>;
}

export function EmailCard({ texts, hours, savedEmail, onSave }: EmailCardProps) {
  const id = useId();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (savedEmail) {
    return (
      <div className="tl-card" role="status">
        {format(texts.emailSaved, { email: savedEmail })}
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = email.trim();
    if (!value || busy) return;

    setBusy(true);
    setFailed(false);
    try {
      await onSave(value);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tl-card">
      <div className="tl-card-head">
        <span className="tl-card-icon">
          <ClockIcon />
        </span>
        <div>
          <p className="tl-card-title">{texts.offlineTitle}</p>
          <p className="tl-card-text">{format(texts.offlineBody, { from: hours.from, to: hours.to, tz: hours.tz })}</p>
        </div>
      </div>
      <form className="tl-email-form" onSubmit={submit}>
        <label className="tl-label" htmlFor={id}>
          {texts.emailLabel}
        </label>
        <div className="tl-email-row">
          <input
            id={id}
            className="tl-input"
            type="email"
            autoComplete="email"
            required
            placeholder={texts.emailPlaceholder}
            value={email}
            aria-invalid={failed || undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button type="submit" className="tl-button" disabled={busy}>
            {texts.notifyMe}
          </button>
        </div>
        {failed && (
          <p className="tl-error" role="alert">
            {texts.emailFailed}
          </p>
        )}
      </form>
    </div>
  );
}

// --- Composer ---------------------------------------------------------------------

interface ComposerProps {
  texts: ThreadliveTexts;
  draft: string;
  onDraft: (value: string) => void;
  onSend: (body: string, files: File[]) => void;
  canWrite: boolean;
  maxLength: number;
  /** Null when files cannot be sent. */
  attachments: AttachmentRules | null;
  files: File[];
  fileErrors: string[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
}

const MAX_INPUT_HEIGHT = 120;

export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer(
  { texts, draft, onDraft, onSend, canWrite, maxLength, attachments, files, fileErrors, onAddFiles, onRemoveFile },
  ref,
) {
  const id = useId();
  const body = draft.trim();
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const canSend = canWrite && (body !== '' || files.length > 0);

  useImperativeHandle(ref, () => field.current as HTMLTextAreaElement);

  // Grow with the text up to a few lines, then scroll inside; back to one
  // line once the draft is sent.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    const borders = el.offsetHeight - el.clientHeight;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + borders, MAX_INPUT_HEIGHT)}px`;
  }, [draft]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    onSend(body, files);
    onDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter is a new line; never mid-composition (IME).
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  // A screenshot pasted with Ctrl+V arrives as a file.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(event.clipboardData?.files ?? []);
    if (attachments && pasted.length > 0) {
      event.preventDefault();
      onAddFiles(pasted);
    }
  };

  return (
    <form className="tl-composer" onSubmit={submit}>
      {fileErrors.length > 0 && (
        <div className="tl-file-errors" role="alert">
          {fileErrors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="tl-drafts">
          {files.map((file, i) => (
            <DraftFile key={`${file.name}-${file.size}-${i}`} file={file} texts={texts} onRemove={() => onRemoveFile(i)} />
          ))}
        </div>
      )}
      <div className="tl-composer-row">
        {attachments && canWrite && (
          <>
            <button type="button" className="tl-attach" aria-label={texts.attach} title={texts.attach} onClick={() => picker.current?.click()}>
              <PaperclipIcon />
            </button>
            <input
              ref={picker}
              type="file"
              className="tl-sr-only"
              tabIndex={-1}
              aria-hidden="true"
              multiple={attachments.max_files > 1}
              accept={attachments.accept.join(',')}
              onChange={(event) => {
                onAddFiles(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = ''; // the same file may be chosen again
              }}
            />
          </>
        )}
        <label className="tl-sr-only" htmlFor={id}>
          {texts.yourMessage}
        </label>
        <textarea
          ref={field}
          id={id}
          className="tl-textarea"
          rows={1}
          value={draft}
          maxLength={maxLength}
          disabled={!canWrite}
          placeholder={canWrite ? texts.placeholder : texts.cannotWrite}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onChange={(event) => onDraft(event.currentTarget.value)}
        />
        <button type="submit" className="tl-send" aria-label={texts.send} disabled={!canSend}>
          <SendIcon />
        </button>
      </div>
    </form>
  );
});

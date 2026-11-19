import type {
  Bootstrap,
  ChatMessage,
  ChatAttachment,
  ConversationState,
  MessagesResult,
  SendContext,
  SendResult,
  SupportHours,
  ThreadliveTransport,
} from './types.js';

/** A request the backend refused. `message` is written for visitors (4xx). */
export class ThreadliveRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ThreadliveRequestError';
    this.status = status;
  }
}

export interface HttpTransportOptions {
  /** e.g. `https://api.example.com/threadlive` */
  apiUrl: string;
  getAuthHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
}

const TOKEN_KEY = 'threadlive:token';

/**
 * The transport for the Laravel package's routes.
 *
 * A guest is known by the token the first sent message returns; it is kept in
 * localStorage (per API) and sent as X-Threadlive-Token. A signed-in visitor
 * is known by whatever `getAuthHeaders` adds.
 */
export function createHttpTransport({ apiUrl, getAuthHeaders }: HttpTransportOptions): ThreadliveTransport {
  const base = apiUrl.replace(/\/+$/, '');
  const tokenKey = `${TOKEN_KEY}:${base}`;

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(await getAuthHeaders?.()),
    };

    const token = readStorage(tokenKey);
    if (token) {
      headers['X-Threadlive-Token'] = token;
    }

    // FormData sets its own multipart Content-Type, boundary included.
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !isForm) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });

    if (!response.ok) {
      throw new ThreadliveRequestError(response.status, await errorMessage(response));
    }

    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  // File links come relative (signed that way, so proxies cannot break
  // them): put the API's origin in front.
  const absolute = (message: ChatMessage): ChatMessage =>
    message.attachments
      ? { ...message, attachments: message.attachments.map((a) => ({ ...a, url: new URL(a.url, base).href })) }
      : message;

  return {
    bootstrap: () => request<Bootstrap>('GET', '/bootstrap'),

    async messages(after) {
      try {
        const result = await request<MessagesResult>('GET', after === null ? '/messages' : `/messages?after=${after}`);

        return { ...result, messages: result.messages.map(absolute) };
      } catch (error) {
        // 404: this visitor has no conversation (pruned, or another device's
        // token). Not a failure — there is just nothing to show.
        if (error instanceof ThreadliveRequestError && error.status === 404) {
          return { messages: [], conversation: null };
        }

        throw error;
      }
    },

    async send({ files, ...input }) {
      let body: unknown = input;

      if (files && files.length > 0) {
        const form = new FormData();
        form.append('body', input.body);
        form.append('client_msg_id', input.client_msg_id);
        if (input.context) form.append('context', JSON.stringify(input.context));
        if (input.turnstile_token) form.append('turnstile_token', input.turnstile_token);
        for (const file of files) form.append('files[]', file, file.name);
        body = form;
      }

      const result = await request<SendResult & { visitor_token?: string }>('POST', '/messages', body);

      // Returned once, with the guest's first message.
      if (result.visitor_token) {
        writeStorage(tokenKey, result.visitor_token);
      }

      return {
        message: absolute(result.message),
        context: result.context ?? null,
        conversation: result.conversation,
      };
    },

    markRead: (messageId) => request<void>('POST', '/read', { message_id: messageId }),

    saveEmail: (email) => request<void>('POST', '/email', { email }),
  };
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { message?: unknown };

    if (typeof data.message === 'string' && data.message !== '') {
      return data.message;
    }
  } catch {
    // Not JSON: fall through to the status line.
  }

  return `HTTP ${response.status}`;
}

// Storage can be missing or throw (private mode, blocked cookies). The widget
// still works then; a guest just starts over on the next page load.
function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // See readStorage.
  }
}

// --- Demo ----------------------------------------------------------------------

export interface DemoTransportOptions {
  /** Within support hours. Default true. */
  online?: boolean;
  agentName?: string;
  /** Replies the demo agent cycles through. */
  replies?: string[];
  hours?: SupportHours;
  /** Delay of every request. */
  latencyMs?: number;
  /** How long the demo agent takes to answer. */
  replyAfterMs?: number;
  /**
   * What the backend's ChatHost::contextLine() would say for this context:
   * a card is added before a message whenever the line changes.
   */
  contextLine?: (context: SendContext | undefined) => string | null;
  /** The first screen's buttons, as config('threadlive.topics') would serve them. */
  topics?: string[];
  /** The header's link out, as config('threadlive.fallback') would serve it. */
  fallback?: { url: string; label: string | null } | null;
}

const DEMO_REPLIES = [
  'Hi! Thanks for writing — let me check that for you.',
  'Got it. I’ll get back to you here in a moment.',
  'Done — anything else I can help with?',
];

/**
 * A backend in memory: an agent who answers every message after a pause.
 * For previews and testbeds, so the widget can be seen without a server.
 */
export function createDemoTransport(options: DemoTransportOptions = {}): ThreadliveTransport {
  const {
    online = true,
    agentName = 'Maria',
    replies = DEMO_REPLIES,
    hours = { from: '09:00', to: '23:00', tz: 'UTC' },
    latencyMs = 400,
    replyAfterMs = 2500,
    contextLine,
    topics = [],
    fallback = null,
  } = options;

  const messages: ChatMessage[] = [];
  let conversation: ConversationState | null = null;
  let nextId = 1;
  let readUpTo = 0;
  let replyCount = 0;

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const snapshot = (): ConversationState | null =>
    conversation && {
      ...conversation,
      unread: messages.filter((m) => m.direction === 'agent' && m.id > readUpTo).length,
      active: conversation.status !== 'closed',
    };

  const add = (message: Omit<ChatMessage, 'id' | 'created_at'>): ChatMessage => {
    const stored = { ...message, id: nextId++, created_at: new Date().toISOString() };
    messages.push(stored);

    return stored;
  };

  const reply = () => {
    if (replyCount === 0) {
      add({ direction: 'system', body: `${agentName} joined the chat` });
    }

    add({ direction: 'agent', body: replies[replyCount % replies.length] ?? '', author: agentName });
    replyCount += 1;

    if (conversation) {
      conversation.status = 'answered';
    }
  };

  return {
    async bootstrap() {
      await wait(latencyMs);

      return {
        enabled: true,
        online,
        hours,
        can_write: true,
        poll_ms: { open: 1500, closed: 5000, idle: 15000, idle_after: 300000 },
        topics,
        fallback,
        attachments: {
          enabled: true,
          max_kb: 10240,
          max_files: 5,
          accept: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'],
        },
        max_message_length: 2000,
        agent_display_name: 'Support',
        conversation: snapshot(),
      };
    },

    async messages(after) {
      await wait(latencyMs / 2);

      return {
        messages: messages.filter((m) => after === null || m.id > after),
        conversation: snapshot(),
      };
    },

    async send({ body, client_msg_id, context, files }) {
      await wait(latencyMs);

      const repeated = messages.find((m) => m.client_msg_id === client_msg_id);

      let card: ChatMessage | null = null;
      const line = repeated ? null : (contextLine?.(context) ?? null);
      const lastCard = [...messages].reverse().find((m) => m.direction === 'context');
      if (line && line !== lastCard?.body) {
        card = add({ direction: 'context', body: line });
      }

      const message =
        repeated ??
        add({
          direction: 'visitor',
          body,
          client_msg_id,
          author: null,
          // In memory only: the browser's own link to the file.
          attachments: (files ?? []).map((file, i) => ({
            id: `${client_msg_id}-${i}`,
            name: file.name,
            mime: file.type,
            size: file.size,
            kind: (file.type.startsWith('image/') ? 'image' : 'file') as ChatAttachment['kind'],
            url: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '',
          })),
        });

      if (!conversation) {
        conversation = { status: 'waiting', unread: 0, email: null, active: true };
      } else if (!repeated) {
        conversation.status = 'waiting';
      }

      if (!repeated && online) {
        setTimeout(reply, replyAfterMs);
      }

      return { message, context: card, conversation: snapshot() as ConversationState };
    },

    async markRead(messageId) {
      readUpTo = Math.max(readUpTo, messageId);
    },

    async saveEmail(email) {
      await wait(latencyMs);

      if (conversation) {
        conversation.email = email;
      }
    },
  };
}

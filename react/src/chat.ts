import type { Bootstrap, ChatMessage, ConversationState } from './types.js';

/** A visitor message the backend has not confirmed yet. */
export interface PendingMessage {
  client_msg_id: string;
  body: string;
  created_at: string;
  state: 'sending' | 'failed';
  /** A reason worth showing the visitor, e.g. a validation message. */
  error?: string;
}

export interface ChatState {
  phase: 'loading' | 'ready' | 'error';
  /** A bootstrap retry is running after an error. */
  retrying: boolean;
  bootstrap: Bootstrap | null;
  /** Confirmed messages, by id. */
  messages: ChatMessage[];
  /** Sent but not confirmed, in the order typed. */
  pending: PendingMessage[];
  conversation: ConversationState | null;
  /** The last poll failed; polling goes on with backoff. */
  reconnecting: boolean;
  /** The full history has been fetched once, so later polls ask for what is new. */
  historyLoaded: boolean;
}

export const initialChatState: ChatState = {
  phase: 'loading',
  retrying: false,
  bootstrap: null,
  messages: [],
  pending: [],
  conversation: null,
  reconnecting: false,
  historyLoaded: false,
};

export type ChatAction =
  | { type: 'bootstrapRetry' }
  | { type: 'bootstrapped'; bootstrap: Bootstrap }
  | { type: 'bootstrapFailed' }
  | { type: 'received'; messages: ChatMessage[]; conversation: ConversationState | null }
  | { type: 'pollFailed' }
  | { type: 'queued'; pending: PendingMessage }
  | { type: 'resending'; clientMsgId: string }
  | {
      type: 'sent';
      clientMsgId: string;
      message: ChatMessage;
      context?: ChatMessage | null;
      conversation: ConversationState;
    }
  | { type: 'sendFailed'; clientMsgId: string; error?: string }
  | { type: 'read' }
  | { type: 'emailSaved'; email: string };

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'bootstrapRetry':
      return { ...state, retrying: true };

    case 'bootstrapped':
      return {
        ...state,
        phase: 'ready',
        retrying: false,
        bootstrap: action.bootstrap,
        conversation: action.bootstrap.conversation,
      };

    case 'bootstrapFailed':
      return { ...state, phase: 'error', retrying: false };

    case 'received': {
      if (action.conversation === null) {
        // Gone on the server (pruned): start over, keeping what is in flight.
        return { ...state, messages: [], conversation: null, reconnecting: false, historyLoaded: false };
      }

      const confirmed = new Set(action.messages.map((m) => m.client_msg_id).filter(Boolean));

      return {
        ...state,
        messages: merge(state.messages, action.messages),
        pending: state.pending.filter((p) => !confirmed.has(p.client_msg_id)),
        conversation: action.conversation,
        reconnecting: false,
        historyLoaded: true,
      };
    }

    case 'pollFailed':
      return { ...state, reconnecting: true };

    case 'queued':
      return { ...state, pending: [...state.pending, action.pending] };

    case 'resending':
      return {
        ...state,
        pending: state.pending.map((p) =>
          p.client_msg_id === action.clientMsgId ? { ...p, state: 'sending', error: undefined } : p,
        ),
      };

    case 'sent':
      return {
        ...state,
        messages: merge(state.messages, action.context ? [action.context, action.message] : [action.message]),
        pending: state.pending.filter((p) => p.client_msg_id !== action.clientMsgId),
        conversation: action.conversation,
      };

    case 'sendFailed':
      return {
        ...state,
        pending: state.pending.map((p) =>
          p.client_msg_id === action.clientMsgId ? { ...p, state: 'failed', error: action.error } : p,
        ),
      };

    case 'read':
      return state.conversation ? { ...state, conversation: { ...state.conversation, unread: 0 } } : state;

    case 'emailSaved':
      return state.conversation ? { ...state, conversation: { ...state.conversation, email: action.email } } : state;
  }
}

/** By id; a message seen again (an agent edited it) replaces the old copy. */
function merge(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) {
    return current;
  }

  const byId = new Map(current.map((m) => [m.id, m]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }

  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** A v4 UUID; crypto.randomUUID exists only in secure contexts. */
export function uuid(): string {
  const crypto = globalThis.crypto;

  if (crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (crypto && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

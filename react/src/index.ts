// Imports keep their .js extension: this package is ESM ("type": "module"),
// and webpack resolves ESM imports only when they are fully specified.
export { Threadlive } from './Threadlive.js';
export { createDemoTransport, createHttpTransport, ThreadliveRequestError } from './transport.js';
export type { DemoTransportOptions, HttpTransportOptions } from './transport.js';
export { DEFAULT_TEXTS } from './texts.js';
export type {
  Bootstrap,
  ChatMessage,
  ConversationState,
  ConversationStatus,
  MessageDirection,
  MessagesResult,
  SendContext,
  SendInput,
  SendResult,
  SupportHours,
  ThreadliveHandle,
  ThreadliveProps,
  ThreadliveTexts,
  ThreadliveTheme,
  ThreadliveTransport,
} from './types.js';
export { VERSION } from './version.js';

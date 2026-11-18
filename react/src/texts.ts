import type { ThreadliveTexts } from './types.js';

export const DEFAULT_TEXTS: ThreadliveTexts = {
  launcher: 'Chat with us',
  open: 'Open support chat',
  openWithUnread: 'Open support chat, {count} new',
  close: 'Close chat',
  minimise: 'Minimise chat',
  title: 'Support',
  online: 'Online',
  replyTime: '',
  away: 'Away · back at {time}',
  continueElsewhere: 'Continue in Telegram instead',
  greeting: 'Hi there,\nhow can we help?',
  intro: 'Write here — our team answers in this window.',
  hours: 'The support team is here {from}–{to}',
  topicsTitle: 'Start with a topic',
  messages: 'Messages',
  you: 'You',
  yourMessage: 'Your message',
  placeholder: 'Type your message…',
  cannotWrite: 'Sign in to write to us.',
  send: 'Send',
  sending: 'Sending…',
  delivered: 'Delivered',
  notSent: 'Not sent',
  retry: 'Retry',
  today: 'Today',
  yesterday: 'Yesterday',
  closedNote: 'This conversation was closed. Write again any time and we’ll pick it up.',
  offlineTitle: 'We’re offline right now',
  offlineBody:
    'Your message is with the team. Support hours are {from}–{to} ({tz}). Leave your e-mail and we’ll send the reply there too.',
  emailLabel: 'E-mail',
  emailPlaceholder: 'you@company.com',
  notifyMe: 'Notify me',
  emailSaved: 'Thanks — we’ll also send the reply to {email}.',
  emailFailed: 'That didn’t work. Check the address and try again.',
  reconnecting: 'Connection lost. Reconnecting…',
  loadFailed: 'The chat didn’t load.',
  tryAgain: 'Try again',
  loading: 'Loading…',
  dismissPreview: 'Dismiss',
};

/** Fills `{name}` placeholders; an unknown one is left as written. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];

    return value === undefined ? match : String(value);
  });
}

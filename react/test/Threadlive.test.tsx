import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Threadlive,
  ThreadliveRequestError,
  type Bootstrap,
  type ChatMessage,
  type ConversationState,
  type MessagesResult,
  type SendInput,
  type SendResult,
  type ThreadliveHandle,
} from '../src/index.js';

afterEach(cleanup);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function boot(overrides: Partial<Bootstrap> = {}): Bootstrap {
  return {
    enabled: true,
    online: true,
    hours: { from: '09:00', to: '23:00', tz: 'UTC' },
    can_write: true,
    poll_ms: { open: 1000, closed: 5000, idle: 5000, idle_after: 300000 },
    topics: [],
    max_message_length: 2000,
    fallback: null,
    attachments: { enabled: true, max_kb: 1024, max_files: 2, accept: ['image/png', 'application/pdf'] },
    agent_display_name: 'Support',
    conversation: null,
    ...overrides,
  };
}

const waiting: ConversationState = { status: 'waiting', unread: 0, active: true };

function agentMessage(id: number, body: string): ChatMessage {
  return { id, direction: 'agent', body, author: 'Maria', created_at: new Date().toISOString() };
}

function fakeTransport(bootstrap = boot()) {
  let nextId = 1;

  return {
    bootstrap: vi.fn(async (): Promise<Bootstrap> => bootstrap),
    messages: vi.fn(async (_after: number | null): Promise<MessagesResult> => ({ messages: [], conversation: waiting })),
    send: vi.fn(
      async ({ body, client_msg_id }: SendInput): Promise<SendResult> => ({
        message: { id: nextId++, direction: 'visitor', body, client_msg_id, created_at: new Date().toISOString() },
        conversation: waiting,
      }),
    ),
    markRead: vi.fn(async (_id: number): Promise<void> => {}),
    saveEmail: vi.fn(async (_email: string): Promise<void> => {}),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const launcher = (name: string | RegExp = 'Open support chat') => screen.findByRole('button', { name });

async function openChat() {
  fireEvent.click(await launcher());

  return screen.getByRole('dialog', { name: 'Support' });
}

function type(text: string) {
  const field = screen.getByLabelText('Your message');
  fireEvent.change(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: 'Enter' });
}

describe('Threadlive', () => {
  it('shows the launcher once the backend says the chat is on', async () => {
    render(<Threadlive transport={fakeTransport()} />);

    expect(await launcher()).toBeTruthy();
  });

  it('renders nothing when the backend turns the chat off', async () => {
    const transport = fakeTransport(boot({ enabled: false }));
    const { container } = render(<Threadlive transport={transport} />);

    await waitFor(() => expect(transport.bootstrap).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('opens on the first screen with the message field focused', async () => {
    render(<Threadlive transport={fakeTransport()} />);
    await openChat();

    expect(screen.getByText(/how can we help/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Your message'));
  });

  it('sends optimistically: Sending…, then Delivered, with the page context and a dedup id', async () => {
    const transport = fakeTransport();
    let finish: (result: SendResult) => void = () => {};
    transport.send.mockImplementationOnce(
      (input) =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              message: { id: 1, direction: 'visitor', body: input.body, created_at: new Date().toISOString() },
              conversation: waiting,
            });
        }),
    );
    render(<Threadlive transport={transport} getContext={() => ({ page: '/orders/DE-1' })} />);
    await openChat();

    type('Hello');

    expect(await screen.findByText(/Sending…/)).toBeTruthy();
    expect(transport.send).toHaveBeenCalledWith({
      body: 'Hello',
      client_msg_id: expect.stringMatching(UUID),
      context: { url: window.location.href, title: document.title, attributes: { page: '/orders/DE-1' } },
    });

    finish({} as SendResult);
    expect(await screen.findByText('Delivered')).toBeTruthy();
    expect((screen.getByLabelText('Your message') as HTMLTextAreaElement).value).toBe('');
  });

  it('says when a send failed, and retries it with the same client_msg_id', async () => {
    const transport = fakeTransport();
    transport.send.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<Threadlive transport={transport} />);
    await openChat();

    type('Hello');
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Delivered')).toBeTruthy();
    const ids = transport.send.mock.calls.map(([input]) => input.client_msg_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it('shows a validation message from the backend as written', async () => {
    const transport = fakeTransport();
    transport.send.mockRejectedValueOnce(
      new ThreadliveRequestError(422, 'The message may not be longer than 2000 characters.'),
    );
    render(<Threadlive transport={transport} />);
    await openChat();

    type('Hello');

    expect(await screen.findByText(/may not be longer than 2000 characters/)).toBeTruthy();
  });

  it('shows the context card a send created, before the message', async () => {
    const transport = fakeTransport();
    transport.send.mockImplementationOnce(async ({ body }) => ({
      context: { id: 1, direction: 'context', body: 'About order DE-260826-WA · Germany', created_at: new Date().toISOString() },
      message: { id: 2, direction: 'visitor', body, created_at: new Date().toISOString() },
      conversation: waiting,
    }));
    render(<Threadlive transport={transport} />);
    await openChat();

    type('Is the withdrawal still pending?');

    const card = await screen.findByText('About order DE-260826-WA · Germany');
    const message = screen.getByText('Is the withdrawal still pending?');
    expect(card.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the topics the server configured, unless the page passes its own', async () => {
    render(<Threadlive transport={fakeTransport(boot({ topics: ['Billing', 'Something else'] }))} />);
    await openChat();

    expect(screen.getByRole('button', { name: 'Billing' })).toBeTruthy();
    cleanup();

    render(<Threadlive transport={fakeTransport(boot({ topics: ['Billing'] }))} topics={['Only this']} />);
    await openChat();

    expect(screen.queryByRole('button', { name: 'Billing' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Only this' })).toBeTruthy();
  });

  it('sends a topic as the first message', async () => {
    const transport = fakeTransport();
    render(<Threadlive transport={transport} topics={['My order', 'Something else']} />);
    await openChat();

    fireEvent.click(screen.getByRole('button', { name: 'My order' }));

    await waitFor(() => expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ body: 'My order' })));
  });

  it('shows unread replies on the closed launcher, and reads them on opening', async () => {
    const transport = fakeTransport(boot({ conversation: { status: 'answered', unread: 1, active: true } }));
    transport.messages.mockResolvedValue({
      messages: [agentMessage(5, 'Hi! Let me check.')],
      conversation: { status: 'answered', unread: 1, active: true },
    });
    const onUnreadChange = vi.fn();
    render(<Threadlive transport={transport} onUnreadChange={onUnreadChange} />);

    const button = await launcher('Open support chat, 1 new');
    expect(await screen.findByText('Maria · Support')).toBeTruthy();
    expect(screen.getByText('Hi! Let me check.')).toBeTruthy();
    expect(onUnreadChange).toHaveBeenLastCalledWith(1);

    fireEvent.click(button);

    await waitFor(() => expect(transport.markRead).toHaveBeenCalledWith(5));
    expect(onUnreadChange).toHaveBeenLastCalledWith(0);
  });

  describe('Turnstile', () => {
    afterEach(() => {
      delete window.turnstile;
    });

    function fakeTurnstile() {
      let issued = 0;
      const api = {
        render: vi.fn((_el: HTMLElement, options: { callback?: (token: string) => void }) => {
          api.issue = () => options.callback?.(`token-${++issued}`);
          setTimeout(api.issue, 0);
          return 'w1';
        }),
        reset: vi.fn(() => setTimeout(api.issue, 0)),
        remove: vi.fn(),
        issue: () => {},
      };
      window.turnstile = api;

      return api;
    }

    it('sends a fresh token with a guest\'s first message, and drops the check after it', async () => {
      const api = fakeTurnstile();
      const transport = fakeTransport(boot({ turnstile_site_key: 'site-key' }));
      render(<Threadlive transport={transport} />);
      await openChat();
      await waitFor(() => expect(api.render).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ sitekey: 'site-key' })));

      type('Hello');

      await waitFor(() =>
        expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ body: 'Hello', turnstile_token: 'token-1' })),
      );
      expect(api.reset).toHaveBeenCalledWith('w1');
      await waitFor(() => expect(api.remove).toHaveBeenCalledWith('w1'));

      type('And more');
      await waitFor(() => expect(transport.send).toHaveBeenCalledTimes(2));
      expect(transport.send.mock.calls[1]?.[0]).not.toHaveProperty('turnstile_token');
    });

    it('asks nothing when the backend sends no site key', async () => {
      const api = fakeTurnstile();
      const transport = fakeTransport();
      render(<Threadlive transport={transport} />);
      await openChat();

      type('Hello');

      await waitFor(() => expect(transport.send).toHaveBeenCalled());
      expect(transport.send.mock.calls[0]?.[0]).not.toHaveProperty('turnstile_token');
      expect(api.render).not.toHaveBeenCalled();
    });
  });

  it('collapses a long message behind "Show more"', async () => {
    const long = Array.from({ length: 20 }, (_, i) => `Step ${i + 1}: do the thing.`).join('\n');
    const transport = fakeTransport(boot({ conversation: { status: 'answered', unread: 0, active: true } }));
    transport.messages.mockResolvedValue({
      messages: [agentMessage(5, long), agentMessage(6, 'Short and sweet.')],
      conversation: { status: 'answered', unread: 0, active: true },
    });
    render(<Threadlive transport={transport} />);
    await openChat();

    const more = await screen.findByRole('button', { name: 'Show more' });
    expect(screen.getAllByRole('button', { name: 'Show more' })).toHaveLength(1);
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(more.getAttribute('aria-controls') ?? '')?.className).toContain('tl-clamped');

    fireEvent.click(more);

    expect(more.textContent).toBe('Show less');
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(more.getAttribute('aria-controls') ?? '')?.className).not.toContain('tl-clamped');
  });

  it('outside support hours: says when the team is back, and takes an e-mail after the first message', async () => {
    const transport = fakeTransport(boot({ online: false }));
    render(<Threadlive transport={transport} />);
    await openChat();

    expect(screen.getByText('Away · back at 09:00')).toBeTruthy();

    type('Can I pay with credits?');
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'anna@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Notify me' }));

    expect(await screen.findByText(/send the reply to anna@example.com/)).toBeTruthy();
    expect(transport.saveEmail).toHaveBeenCalledWith('anna@example.com');
  });

  it('closes on Escape and gives focus back to the launcher', async () => {
    render(<Threadlive transport={fakeTransport()} />);
    await openChat();

    fireEvent.keyDown(screen.getByLabelText('Your message'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open support chat' }));
  });

  describe('a hidden tab', () => {
    let hidden = false;
    const setHidden = (value: boolean) => {
      hidden = value;
      document.dispatchEvent(new Event('visibilitychange'));
    };

    beforeEach(() => {
      hidden = false;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.title = 'Acme';
    });
    afterEach(() => {
      delete (document as { hidden?: boolean }).hidden;
    });

    it('stops polling when no reply is awaited, and resumes when the tab is shown', async () => {
      const answered: ConversationState = { status: 'answered', unread: 0, active: true };
      const transport = fakeTransport(
        boot({ conversation: answered, poll_ms: { open: 20, closed: 20, idle: 20, idle_after: 300000 } }),
      );
      transport.messages.mockResolvedValue({ messages: [], conversation: answered });
      render(<Threadlive transport={transport} />);
      await waitFor(() => expect(transport.messages).toHaveBeenCalled());

      setHidden(true);
      await sleep(40); // a request already in flight may still finish
      const whileHidden = transport.messages.mock.calls.length;
      await sleep(150); // seven poll intervals
      expect(transport.messages.mock.calls.length).toBe(whileHidden);

      setHidden(false);
      await waitFor(() => expect(transport.messages.mock.calls.length).toBeGreaterThan(whileHidden));
    });

    it('keeps checking while the visitor awaits a reply, and puts it in the tab title', async () => {
      const transport = fakeTransport(
        boot({ conversation: waiting, poll_ms: { open: 20, closed: 20, idle: 20, idle_after: 300000 } }),
      );
      render(<Threadlive transport={transport} />);
      await waitFor(() => expect(transport.messages).toHaveBeenCalled());

      setHidden(true);
      transport.messages.mockResolvedValue({
        messages: [agentMessage(9, 'Here is your answer.')],
        conversation: { status: 'answered', unread: 1, active: true },
      });

      await waitFor(() => expect(document.title).toBe('(1) Acme'));

      setHidden(false);
      await waitFor(() => expect(document.title).toBe('Acme'));
    });
  });

  it('does not poll a conversation that is no longer live while the panel is closed', async () => {
    const transport = fakeTransport(
      boot({
        conversation: { status: 'closed', unread: 0, active: false },
        poll_ms: { open: 20, closed: 20, idle: 20, idle_after: 300000 },
      }),
    );
    render(<Threadlive transport={transport} />);
    await launcher();
    await sleep(120);

    expect(transport.messages).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Open support chat' }));
    await waitFor(() => expect(transport.messages).toHaveBeenCalled());
  });

  it('stops polling while the visitor is idle, and checks at once on their next move', async () => {
    const transport = fakeTransport(
      boot({ conversation: waiting, poll_ms: { open: 20, closed: 20, idle: 20, idle_after: 60 } }),
    );
    render(<Threadlive transport={transport} />);
    await waitFor(() => expect(transport.messages).toHaveBeenCalled());

    await sleep(150); // idle after 60 ms
    const whileIdle = transport.messages.mock.calls.length;
    await sleep(150);
    expect(transport.messages.mock.calls.length).toBe(whileIdle);

    fireEvent.keyDown(document.body, { key: 'a' });
    await waitFor(() => expect(transport.messages.mock.calls.length).toBeGreaterThan(whileIdle));
  });

  it('shows the header link the server configured, unless the page passes its own; none without either', async () => {
    const fromServer = { url: 'https://t.me/acme_support', label: 'Write to us in Telegram' };

    render(<Threadlive transport={fakeTransport(boot({ fallback: fromServer }))} />);
    await openChat();
    expect(screen.getByRole('link', { name: 'Write to us in Telegram' }).getAttribute('href')).toBe('https://t.me/acme_support');
    cleanup();

    render(<Threadlive transport={fakeTransport(boot({ fallback: fromServer }))} fallbackUrl="mailto:help@acme.test" />);
    await openChat();
    expect(screen.getByRole('link', { name: 'Write to us in Telegram' }).getAttribute('href')).toBe('mailto:help@acme.test');
    cleanup();

    render(<Threadlive transport={fakeTransport()} />);
    await openChat();
    expect(screen.queryByRole('link')).toBeNull();
  });

  describe('the launcher', () => {
    it('is a pill with the text by default', async () => {
      render(<Threadlive transport={fakeTransport()} />);

      const button = await launcher();
      expect(button.textContent).toContain('Chat with us');
      expect(button.getAttribute('data-variant')).toBe('pill');
    });

    it('can be a round icon-only button, with the site\'s own icon', async () => {
      render(
        <Threadlive transport={fakeTransport()} launcher="icon" launcherIcon={<svg data-testid="own-icon" />} />,
      );

      const button = await launcher();
      expect(button.getAttribute('data-variant')).toBe('icon');
      expect(button.textContent).not.toContain('Chat with us');
      expect(screen.getByTestId('own-icon')).toBeTruthy();
    });

    it('can be left out, for the site\'s own button to open the chat', async () => {
      const ref = createRef<ThreadliveHandle>();
      const transport = fakeTransport();
      render(<Threadlive transport={transport} launcher="none" ref={ref} />);
      await waitFor(() => expect(transport.bootstrap).toHaveBeenCalled());
      await sleep(10);

      expect(screen.queryByRole('button', { name: 'Open support chat' })).toBeNull();

      act(() => ref.current?.open());
      expect(await screen.findByRole('dialog', { name: 'Support' })).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Minimise chat' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('the first screen', () => {
    const answered = (status: ConversationState['status']) => {
      const transport = fakeTransport(
        boot({ conversation: { status, unread: 0, active: status !== 'closed' }, topics: ['Billing', 'Something else'] }),
      );
      transport.messages.mockResolvedValue({
        messages: [agentMessage(5, 'Your order is on its way.')],
        conversation: { status, unread: 0, active: status !== 'closed' },
      });

      return transport;
    };

    it('opens a conversation going on, with Home leading back to the topics', async () => {
      const transport = answered('answered');
      render(<Threadlive transport={transport} />);
      await openChat();

      expect(await screen.findByText('Your order is on its way.')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Home' }));

      expect(screen.getByRole('button', { name: 'Billing' })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Continue the conversation/ }).textContent).toContain(
        'Maria: Your order is on its way.',
      );
    });

    it('sends a topic chosen there into the same conversation, and shows it', async () => {
      const transport = answered('answered');
      render(<Threadlive transport={transport} />);
      await openChat();
      await screen.findByText('Your order is on its way.');

      fireEvent.click(screen.getByRole('button', { name: 'Home' }));
      fireEvent.click(screen.getByRole('button', { name: 'Billing' }));

      await waitFor(() => expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ body: 'Billing' })));
      expect(screen.queryByRole('button', { name: 'Billing' })).toBeNull();
      expect(screen.getByText('Your order is on its way.')).toBeTruthy();
    });

    it('opens on the first screen once the conversation was closed, the history one tap away', async () => {
      render(<Threadlive transport={answered('closed')} />);
      await openChat();

      expect(screen.getByRole('button', { name: 'Billing' })).toBeTruthy();
      fireEvent.click(await screen.findByRole('button', { name: /Continue the conversation/ }));

      expect(await screen.findByText('Your order is on its way.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Billing' })).toBeNull();
    });

    it('has no Home button before there is anything else to go to', async () => {
      render(<Threadlive transport={fakeTransport()} />);
      await openChat();

      expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Continue the conversation/ })).toBeNull();
    });
  });

  describe('files', () => {
    const png = (name = 'cashier.png', size = 2000) => new File([new Uint8Array(size)], name, { type: 'image/png' });

    it('attaches a file, shows it, and sends it with the message', async () => {
      const transport = fakeTransport();
      transport.send.mockImplementationOnce(async ({ body, files }) => ({
        message: {
          id: 1,
          direction: 'visitor',
          body,
          created_at: new Date().toISOString(),
          attachments: (files ?? []).map((f, i) => ({
            id: String(i),
            name: f.name,
            mime: f.type,
            size: f.size,
            kind: 'image' as const,
            url: `https://api.example.com/threadlive/files/1/${i}?signature=x`,
          })),
        },
        conversation: waiting,
      }));
      render(<Threadlive transport={transport} />);
      await openChat();

      fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
        target: { files: [png()] },
      });
      expect(screen.getByRole('button', { name: 'Remove cashier.png' })).toBeTruthy();

      type('Here is the screen');

      await waitFor(() =>
        expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ body: 'Here is the screen', files: [expect.any(File)] })),
      );
      const image = await screen.findByRole('img', { name: 'cashier.png' });
      expect(image.closest('a')?.getAttribute('href')).toBe('https://api.example.com/threadlive/files/1/0?signature=x');
      expect(screen.queryByRole('button', { name: 'Remove cashier.png' })).toBeNull();
    });

    it('sends files without text', async () => {
      const transport = fakeTransport();
      render(<Threadlive transport={transport} />);
      await openChat();

      fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [png()] } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      await waitFor(() => expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ body: '' })));
    });

    it('says why a file cannot go, before uploading anything', async () => {
      render(<Threadlive transport={fakeTransport()} />);
      await openChat();
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [new File(['x'], 'setup.exe', { type: 'application/x-msdownload' })] } });
      expect(await screen.findByText('setup.exe cannot be sent: images and PDF files only.')).toBeTruthy();

      fireEvent.change(input, { target: { files: [png('big.png', 2 * 1024 * 1024)] } });
      expect(await screen.findByText('big.png is over 1 MB.')).toBeTruthy();

      fireEvent.change(input, { target: { files: [png('a.png'), png('b.png'), png('c.png')] } });
      expect(await screen.findByText('Up to 2 files in one message.')).toBeTruthy();
      expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(2);
    });

    it('takes a pasted screenshot', async () => {
      render(<Threadlive transport={fakeTransport()} />);
      await openChat();

      fireEvent.paste(screen.getByLabelText('Your message'), { clipboardData: { files: [png('pasted.png')] } });

      expect(screen.getByRole('button', { name: 'Remove pasted.png' })).toBeTruthy();
    });

    it('offers no paperclip when files are turned off', async () => {
      render(
        <Threadlive
          transport={fakeTransport(boot({ attachments: { enabled: false, max_kb: 1, max_files: 1, accept: [] } }))}
        />,
      );
      await openChat();

      expect(screen.queryByRole('button', { name: 'Attach a file' })).toBeNull();
    });
  });

  it('turns the theme into CSS variables, leaving the rest to the stylesheet', async () => {
    const { container } = render(
      <Threadlive transport={fakeTransport()} theme={{ accent: '#ff0000', offsetY: '80px' }} />,
    );
    await launcher();
    const root = container.querySelector<HTMLElement>('.tl-root');

    expect(root?.style.getPropertyValue('--tl-accent')).toBe('#ff0000');
    expect(root?.style.getPropertyValue('--tl-offset-y')).toBe('80px');
    expect(root?.style.getPropertyValue('--tl-header-bg')).toBe('');
  });

  it('renders nothing while hidden', async () => {
    const transport = fakeTransport();
    const { container } = render(<Threadlive transport={transport} hidden />);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.innerHTML).toBe('');
    expect(transport.bootstrap).not.toHaveBeenCalled();
  });
});

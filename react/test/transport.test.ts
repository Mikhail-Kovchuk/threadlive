import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHttpTransport, ThreadliveRequestError } from '../src/index.js';

const API = 'https://api.example.com/threadlive/';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createHttpTransport', () => {
  it('keeps the guest token from the first send and sends it from then on', async () => {
    const transport = createHttpTransport({ apiUrl: API, getAuthHeaders: () => ({ Authorization: 'Bearer jwt' }) });
    fetchMock.mockResolvedValueOnce(
      json(201, {
        message: { id: 1, direction: 'visitor', body: 'Hi', created_at: '2026-11-18T10:00:00Z' },
        conversation: { status: 'waiting', unread: 0 },
        visitor_token: 'secret-token',
      }),
    );
    fetchMock.mockResolvedValueOnce(json(200, { messages: [], conversation: { status: 'waiting', unread: 0 } }));

    await transport.send({ body: 'Hi', client_msg_id: 'id-1' });
    await transport.messages(1);

    const [sendUrl, sendInit] = fetchMock.mock.calls[0] ?? [];
    expect(sendUrl).toBe('https://api.example.com/threadlive/messages');
    expect(sendInit?.method).toBe('POST');
    expect(JSON.parse(String(sendInit?.body))).toEqual({ body: 'Hi', client_msg_id: 'id-1' });

    const [pollUrl, pollInit] = fetchMock.mock.calls[1] ?? [];
    expect(pollUrl).toBe('https://api.example.com/threadlive/messages?after=1');
    expect(pollInit?.headers).toMatchObject({ 'X-Threadlive-Token': 'secret-token', Authorization: 'Bearer jwt' });
  });

  it('sends files as multipart, and makes the file links absolute', async () => {
    const transport = createHttpTransport({ apiUrl: API });
    fetchMock.mockResolvedValueOnce(
      json(201, {
        message: {
          id: 1,
          direction: 'visitor',
          body: '',
          created_at: '2026-11-18T10:00:00Z',
          attachments: [{ id: 'a', name: 'cashier.png', mime: 'image/png', size: 5, kind: 'image', url: '/threadlive/files/1/a?signature=s' }],
        },
        conversation: { status: 'waiting', unread: 0, active: true },
      }),
    );

    const result = await transport.send({
      body: '',
      client_msg_id: 'id-1',
      context: { url: 'https://example.com/', title: 'Home', attributes: {} },
      files: [new File(['png'], 'cashier.png', { type: 'image/png' })],
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    const form = init?.body as FormData;
    expect(form.get('client_msg_id')).toBe('id-1');
    expect(JSON.parse(String(form.get('context')))).toMatchObject({ url: 'https://example.com/' });
    expect((form.get('files[]') as File).name).toBe('cashier.png');

    expect(result.message.attachments?.[0]?.url).toBe('https://api.example.com/threadlive/files/1/a?signature=s');
  });

  it('reads a 404 for the messages as "no conversation", not as a failure', async () => {
    fetchMock.mockResolvedValueOnce(json(404, { message: 'Not found.' }));

    await expect(createHttpTransport({ apiUrl: API }).messages(null)).resolves.toEqual({
      messages: [],
      conversation: null,
    });
  });

  it('rejects with the backend\'s message, written for visitors', async () => {
    fetchMock.mockResolvedValueOnce(json(422, { message: 'The message may not be longer than 2000 characters.' }));

    const error = await createHttpTransport({ apiUrl: API })
      .send({ body: 'x', client_msg_id: 'id' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ThreadliveRequestError);
    expect((error as ThreadliveRequestError).status).toBe(422);
    expect((error as ThreadliveRequestError).message).toBe('The message may not be longer than 2000 characters.');
  });
});

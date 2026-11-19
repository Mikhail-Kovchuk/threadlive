# threadlive-react

**Threadlive — live chat in Telegram threads.** The widget for your website.
Your support team answers each conversation in its own topic of a Telegram
forum group; the backend side is
[`threadlive/threadlive-laravel`](https://github.com/Mikhail-Kovchuk/threadlive-laravel).

> 🚧 **Work in progress.** Not released yet.

Requirements: React 18 or 19. Works with server rendering (Next.js pages and
app router): the widget renders nothing on the server and mounts in the
browser.

## Use

```tsx
import 'threadlive-react/styles.css';
import { Threadlive } from 'threadlive-react';

<Threadlive
  apiUrl="https://api.example.com/threadlive"
  getAuthHeaders={async () => ({ Authorization: `Bearer ${token}` })}
/>
```

Hours, topics, the header's link out, translation and attachments come from
the backend's `config/threadlive.php`; nothing to release on the frontend
when they change.

## Make it yours

The look and the words belong to your site:

```tsx
<Threadlive
  apiUrl={apiUrl}
  logo={<img src="/logo.svg" alt="" />}
  texts={{ title: 'Acme Support', replyTime: 'usually replies in 5 min', launcher: 'Ask us' }}
  theme={{ accent: '#0066FF', headerBg: '#011936', fontFamily: 'var(--font-geist)', offsetY: '80px' }}
  position="right"
/>
```

Every text has an English default (`DEFAULT_TEXTS`); pass yours to translate.
Every class starts with `tl-` and every colour is a `--tl-*` variable, so
plain CSS on your site reaches anything else.

### The launcher

| | |
|---|---|
| `launcher="pill"` (default) | icon and `texts.launcher`; round on phones |
| `launcher="icon"` | round, icon only, on every screen |
| `launcherIcon={<svg … />}` | your icon instead of the chat bubble |
| `launcher="none"` | no button: use your own, anywhere |

With your own button:

```tsx
const chat = useRef<ThreadliveHandle>(null);
const [unread, setUnread] = useState(0);

<button onClick={() => chat.current?.open()}>Support {unread > 0 && `(${unread})`}</button>
<Threadlive ref={chat} apiUrl={apiUrl} launcher="none" onUnreadChange={setUnread} />
```

### Replies in the background

A reply the visitor cannot see puts "(1)" in the tab's title while the tab is
hidden and plays a soft chime (synthesised, no file). While the visitor waits
for an answer the widget keeps checking in a hidden tab, until they have been
away for `poll_ms.idle_after`. Turn either off:

```tsx
<Threadlive apiUrl={apiUrl} notify={{ sound: false }} />
```

## License

[MIT](LICENSE)

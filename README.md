# Threadlive

**Live chat in Telegram threads.**

A chat widget for your website whose conversations your support team answers
**inside Telegram**. A visitor writes in the widget → the message lands in a
private Telegram forum group, one **topic per conversation** → a manager
replies in that topic → the reply appears in the widget.

No support dashboard to learn, no extra app to install: your team keeps working
in Telegram.

> 🚧 **Work in progress.** Nothing is released yet; the packages below are not
> on Packagist or npm.

## Packages

One repository, two packages, released together under the same version:

| Folder | Package | For |
|---|---|---|
| `laravel/` | [`threadlive/threadlive-laravel`](https://github.com/Mikhail-Kovchuk/threadlive-laravel) (composer) | Your Laravel backend: API, Telegram webhook, topics, scheduling |
| `react/` | `threadlive-react` (npm) | The widget on your website |

Requirements: PHP 8.3+, Laravel 12 or 13, React 18 or 19.

## License

[MIT](LICENSE)

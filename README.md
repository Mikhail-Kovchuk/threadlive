# Threadlive

**Live chat in Telegram threads.**

A chat widget for your website whose conversations your support team answers
**inside Telegram**. A visitor writes in the widget → the message lands in a
private Telegram forum group, one **topic per conversation** → a manager
replies in that topic → the reply appears in the widget.

No support dashboard to learn, no extra app to install: your team keeps working
in Telegram.

## Packages

One repository, two packages, released together under the same version:

| Folder | Package | For |
|---|---|---|
| `laravel/` | [`threadlive/threadlive-laravel`](https://packagist.org/packages/threadlive/threadlive-laravel) (composer) | Your Laravel backend: API, Telegram webhook, topics, scheduling — [setup](laravel/README.md) |
| `react/` | [`threadlive-react`](https://www.npmjs.com/package/threadlive-react) (npm) | The widget on your website — [usage](react/README.md) |

Requirements: PHP 8.3+, Laravel 12 or 13, React 18 or 19.

```bash
composer require threadlive/threadlive-laravel && php artisan threadlive:install
npm i threadlive-react
```

All commands, for apps and for working on this repository:
[COMMANDS.md](COMMANDS.md). Changes: [laravel](laravel/CHANGELOG.md),
[react](react/CHANGELOG.md).

## Maintaining

- `laravel/composer.json` has no `version`: composer installs from the
  `threadlive-laravel` mirror, where the git tag is the version, and a field
  that disagreed with the tag would make composer skip that release.
- It requires `laravel/framework`, not `illuminate/*` parts: the package uses
  the framework's events, jobs, mail, views, HTTP client and scheduler.
- `config.platform.php` is `8.3.0`, so composer resolves what the lowest
  supported PHP can run, whatever PHP runs it.
- Releases: `git tag vX.Y.Z && git push origin vX.Y.Z` — see COMMANDS.md.
  From v0.1.0 on, the migration is released: a schema change is a new
  migration, never an edit of the old one.

## License

[MIT](LICENSE)

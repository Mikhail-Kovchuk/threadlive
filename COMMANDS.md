# Commands

Everything you run on Threadlive, in one place. Add new ones here as they
appear.

## In an application that uses the package

| Command | What it does |
|---|---|
| `composer require threadlive/threadlive-laravel` | Add the backend package |
| `php artisan threadlive:install` | Publish the config, the migration and `app/Threadlive/ChatHost.php`; add the `.env` keys (with a webhook secret); warn about CORS and a `sync` queue. `--force` starts the config over (keeps a `.bak`) and overwrites ChatHost. `--no-migrate` skips the migration |
| `php artisan threadlive:config` | Create `config/threadlive.php`, or — after a package update — add the settings it brought, keeping your values. `--force` starts over (keeps `config/threadlive.php.bak`) |
| `php artisan threadlive:make-command Invoice` | Create `app/Threadlive/Commands/InvoiceCommand.php` (`/invoice` for managers) and list it in the config |
| `php artisan threadlive:setup` | Check the bot, the group (Topics, admin rights), the HTTPS address; set the webhook; put the commands in the group's "/" menu; post the dashboard |
| `php artisan threadlive:setup --local` | The same without a webhook, for a machine with no public HTTPS — then run `threadlive:listen` |
| `php artisan threadlive:listen` | Take Telegram updates by polling (local development). `--drop-webhook` removes a webhook first — never on a production bot. `--once` for one round |
| `php artisan threadlive:status` | The webhook as Telegram sees it (last error, pending updates), conversation counts, messages not delivered |
| `php artisan threadlive:retry-failed` | Send again the visitor messages delivery gave up on (the dashboard's "⚠️ Not delivered"). `--conversation=12` for one |
| `php artisan threadlive:test` | Open a test topic in the group, post in it, close it |
| `php artisan threadlive:maintain` | Auto-close, delete old topics, "⏰ waiting" alerts, dashboard. Scheduled every 5 min by the package |
| `php artisan threadlive:prune` | Delete conversations past `retention_days` with their files and topics. Scheduled daily |
| `php artisan queue:work` | Needed: messages go to Telegram from the queue |
| `php artisan schedule:run` (cron, every minute) | Needed: runs maintain and prune |
| `npm i threadlive-react` | Add the widget |

## In the support group (Telegram)

| Command | What it does |
|---|---|
| `/close` | In a conversation's topic: close it (the visitor sees "Conversation closed") |
| `/translate` | In a topic: translation on for this conversation — visitor messages arrive with a translation into the default language, replies go out in the visitor's language. Again: off |
| `/translate ru` | The same into another language from `translation.languages` |
| `/translate off` | Translation off for this conversation |
| `// text` | An internal note: stays in the topic, never reaches the visitor |
| `/<your command> <argument>` | The app's own commands (`config('threadlive.commands')`), e.g. `/invoice INV-1042`; without an argument the bot asks for it |

The "/" menu of the group is set by `php artisan threadlive:setup` — run it
again after changing the commands or the translation setup.

## Developing the packages

### `laravel/`

```bash
cd laravel
composer update                       # Laravel 13 + Testbench 11 by default
vendor/bin/pest                       # tests
vendor/bin/phpstan analyse --memory-limit=1G
vendor/bin/pint                       # fix style (pint --test to check)

# Laravel 12, and the oldest versions composer.json allows (as CI does)
composer update --with "orchestra/testbench:10.*"
composer update --with "orchestra/testbench:10.*" --prefer-lowest --prefer-stable
composer update                       # back to the newest
```

On Windows write `10.*`, not `^10.0`: cmd removes the `^`.

### `react/`

```bash
cd react
npm ci
npm test                              # Vitest (through scripts/vitest.mjs)
npm run typecheck
npm run build                         # dist/ + styles.css

# React 18, as CI does
npm install --no-save react@18 react-dom@18 @types/react@18 @types/react-dom@18
npm run typecheck && npm test
npm install                           # back to React 19
```

### Release

```bash
git tag v0.1.0 && git push origin v0.1.0
```

`.github/workflows/release.yml` splits `laravel/` into the
`threadlive-laravel` mirror (needs the `THREADLIVE_LARAVEL_TOKEN` secret) and
publishes `react/` to npm (the first version by hand: `cd react && npm
publish`, then trusted publishing).

## Local testbeds

Next to this repo: `../threadlive-testbed` (Laravel, :8020) and
`../threadlive-ui-testbed` (Next.js, :3020).

```bash
# Laravel testbed
cd ../threadlive-testbed
composer reinstall threadlive/threadlive-laravel   # copy the package again after changing it
php artisan threadlive:setup --local               # once, and after changing commands
composer dev                                        # server :8020 + queue + scheduler + threadlive:listen

# UI testbed
cd ../threadlive/react && npm run build            # or: npx tsc -p tsconfig.build.json --watch
cd ../../threadlive-ui-testbed
npm run dev                                         # http://localhost:3020
# .env.local: NEXT_PUBLIC_THREADLIVE_API_URL=http://127.0.0.1:8020/threadlive
# (remove it for the in-memory demo backend; /?offline=1 shows outside hours)
```

After `composer reinstall`, restart `composer dev` (listen and the queue
worker keep the old code).

The package's migration changes in place until the first release. To give
the Laravel testbed the new schema: stop `composer dev` (a running server
writes to the same SQLite file), copy
`../threadlive/laravel/database/migrations/2026_11_18_000000_create_threadlive_tables.php`
over the testbed's `database/migrations/*_create_threadlive_tables.php`, then
`php artisan migrate:fresh` and `php artisan threadlive:setup --local`. If `npm run build` fails with "Duplicate
identifier 'PagesPageConfig'", delete `.next`.

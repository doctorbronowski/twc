# TWC Work Search

Local React/Vite application and Express API for the TWC work-search activity
project.

## Requirements

- Node.js 22.18 or newer
- pnpm

## Start the development servers

```sh
pnpm install
cp .env.example .env.local
# Set DB_PASSWORD in .env.local.
# In Terminal, from the project directory and an interactive Bash shell:
read -r -p "MySQL admin username: " DB_ADMIN_USER
read -r -s -p "MySQL admin password: " DB_ADMIN_PASSWORD
printf '\n'
export DB_ADMIN_USER DB_ADMIN_PASSWORD
pnpm db:setup && pnpm db:bootstrap-owner
unset DB_ADMIN_USER DB_ADMIN_PASSWORD
```

The admin password is entered without echo and is not placed in shell history.
Back up an existing database before setup. `pnpm db:bootstrap-owner` prompts
for the initial owner's email and a hidden password, assigns unowned activities
to that account, and finalizes the ownership constraint. Run the app only after
both commands succeed. Start it with `pnpm dev`.

The frontend is available directly at <http://127.0.0.1:5174> and through
Apache at <http://twc.local.com>. The API listens on `127.0.0.1:3002`; Vite
proxies `/api` requests to Express. `GET /api/health` checks API availability.
All `/api/activities` endpoints require an authenticated session and operate
only on the signed-in account's records. `GET /api/activities?page=1&pageSize=5`
lists activities and returns pagination metadata. Page sizes of 5, 10, 25, 50,
and 100 are supported; the default is 5. `GET /api/activities` defaults to page
1 and page size 5. `POST /api/activities` creates an activity;
`PUT /api/activities/:id` updates an existing activity. Database setup creates
the `twc` schema and a `twc_app` account with narrowly scoped access to
activity and account tables.
The owner bootstrap does not overwrite an existing account's password or
reassign already-owned activities. Keep the admin credentials out of
`.env.local` and source control.

Authentication uses `APP_BASE_URL` for email links and origin checks. Set
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and
`SMTP_FROM` in the local ignored environment file before testing email
delivery. SMTP configuration is loaded only when an email is sent.
Public registration is disabled by default; enable it only after the owner
bootstrap and authenticated, owner-scoped activity API are ready.
The UI provides sign-in, session-expiration reauthentication, account creation,
email verification, and password recovery/reset flows.

Apache must be running to use the `twc.local.com` address. In this environment
it is started manually; if it is stopped, run
`sudo /opt/local/sbin/apachectl start`.

## Production Node.js startup

The production server serves the Vite build and API from one origin, including
direct loads of `/search`, `/export`, and `/export/print`. Build with
`pnpm build`, then start with `pnpm start` or use `app.js` as the cPanel
startup file. The entry point dynamically imports the ESM server for
compatibility with Passenger's loader. Production requires
`NODE_ENV=production` and uses the hosting platform's `PORT` when available,
falling back to port `3000`; configure
`DB_HOST`, `DB_PORT`, `DB_NAME`,
`DB_USER`, `DB_PASSWORD`, `APP_BASE_URL`, `APP_ALLOWED_ORIGINS`, and SMTP
settings in cPanel's application environment. Keep
`PUBLIC_REGISTRATION_ENABLED=false` until the owner bootstrap and authenticated,
owner-scoped activity API are ready. Keep SMTP credentials in the hosting
provider's secret environment settings. Do not upload `.env.local` or use the
local database setup script on the hosting account.
The document-root `.htaccess` should hold only the Passenger directives for
this Node app; leave out any legacy PHP rewrite rules.

## Pages

- `/` — welcome dashboard with links to Enter and Search.
- `/enter` — responsive work-search activity form with calendar date inputs,
  Job Source URL, state selection, phone mask, Clear, and Submit actions.
- `/search` — responsive, paginated list of all activities with selectable
  page sizes (5, 10, 25, 50, or 100), a read-only details modal, and an edit
  modal for each record, including Job Source URL.
- `/export` — paginated activity selection with cross-page checkboxes, a
  10-activity selection limit, selected-record removal, and a print preview.
- `/export/print` — full details for selected records with browser print and
  Save as PDF instructions; each activity starts on a separate printed page.

The form submits to the local API and retains its values after both successful
and unsuccessful saves. TWC uses Vite port `5174` and Express port `3002`;
Hypori uses separate ports `5173` and `3001` so both projects can run at once.

## Checks

```sh
pnpm lint
pnpm test
pnpm build
```

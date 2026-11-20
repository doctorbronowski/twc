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

Vite serves the frontend at <https://127.0.0.1:5174> using the locally trusted
certificate `~/.certs/twc.pem` and private key `~/.certs/twc-key.pem`. Create
and trust a certificate for this address (for example with `mkcert`) before
starting Vite. Keep the private key out of source control.
Set `APP_BASE_URL=https://127.0.0.1:5174` in `.env.local` so authentication
origin checks and email links use HTTPS.

The API listens on `127.0.0.1:3002`; Vite
proxies `/api` requests to Express. `GET /api/health` checks API availability.
All `/api/activities` endpoints require an authenticated session and operate
only on the signed-in account's records. `GET /api/activities?page=1&pageSize=5`
lists activities and returns pagination metadata. Page sizes of 5, 10, 25, 50,
and 100 are supported; the default is 5. `GET /api/activities` defaults to page
1 and page size 5. `POST /api/activities` creates an activity;
`PUT /api/activities/:id` updates an existing activity, and
`DELETE /api/activities/:id` deletes an owned activity. Existing
local database installations need the updated activity-table `DELETE` grant;
after a backup, rerun `pnpm db:setup` with admin credentials, or apply that
grant separately. Grant the equivalent privilege to the production runtime
database user before deploying this feature.
Database setup creates
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
Each account permits one active browser session. A sign-in from another
browser is rejected until the existing session signs out or expires after
15 minutes of inactivity. Tabs sharing a session cookie share that session;
separate browsers on the same computer count as separate sessions. If older
data contains multiple active sessions, only the oldest remains valid when
that account next signs in or makes an authenticated request.

The local Apache configuration serves <https://twc.local.com> without a port
and proxies to Vite over HTTPS. To use it, set
`APP_BASE_URL=https://twc.local.com` in `.env.local`; the corresponding Vite
origin can be retained in `APP_ALLOWED_ORIGINS` for direct access. Apache is
started manually in this environment; if it is stopped, run
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
The optional demo schema foundation has a one-time production migration in
`migrations/20261119_demo_schema.sql`; follow its preconditions and
apply database grants separately. The migration alone does not enable a demo.
The migrations directory is Git-ignored.
The shared demo-start limiter has a separate one-time production migration in
`migrations/20261120_demo_start_rate_limit.sql`. The application database
user needs `SELECT`, `INSERT`, and `DELETE` on `demo_start_attempts`, granted
separately by an administrator. The local setup command creates this table
and grants those permissions.
The demo creation backend copies from `DEMO_TEMPLATE_EMAIL` (initially
`twc@hitsdev.com`) and caps all demo accounts, including those awaiting
cleanup, with `DEMO_ACCOUNT_LIMIT` (initially `10`). Demo activity writes are
capped by `DEMO_ACTIVITY_LIMIT` (initially `20`); the cap includes copied
activities. Configure these values in the private local environment and
later in the production application environment before demo mode is enabled.
An invalid activity limit prevents startup; demo writes fail closed if it is
absent. The shared limiter allows at most 10 attempts per IP in a rolling
15-minute window across workers. It stores HMAC-SHA256 hashes rather than
raw IP addresses; set `DEMO_IP_HASH_SECRET` to the same private, randomly
generated 32-byte base64url value for every worker before enabling demo
starts. Changing that secret resets the effective IP limits. Expired limiter
records are removed in batches when starts are attempted; if there is no
traffic, expired hashes remain until subsequent attempts or future scheduled
maintenance.

Demo mode is disabled by default (`DEMO_ENABLED=false`). When enabled, the
sign-in page offers a temporary demo, with a five-minute inactivity timeout
and a persistent demo banner. Demo users cannot manage an account; sign-out
and expiration clear the tab's export selections and preview. Browser tabs
coordinate demo activity and sign-out when browser storage or broadcast
channels are available; the server remains authoritative. The client
uses the database-reported remaining lifetime, conservatively measured from
the start of the last successful authenticated request. Network delays can
therefore end a demo slightly early without relying on the browser and
database clocks matching.

The demo-start API requires a trusted origin and an `Idempotency-Key`
containing 32 random bytes encoded as unpadded base64url. A successful request
sets a five-minute demo session cookie; reusing a successful key returns a
conflict rather than creating another account. An existing valid session is not
replaced. The key is retained only until the demo account is cleaned up.

The separate one-time production migration
`migrations/20261120_demo_start_idempotency.sql` creates the request
table; an administrator must separately grant the application database user
`SELECT` and `INSERT` on `demo_start_requests`. The local setup command creates
the table and grants those permissions. Test the migration against the actual
production MariaDB version before deployment.

Before enabling demos, verify exactly how Passenger and any proxies provide
client addresses. Set `DEMO_CLIENT_IP_SOURCE=direct` only if the Node socket
address is the real client. For `forwarded`, set `DEMO_TRUSTED_PROXY_IP` to the
exact immediate proxy address and verify that it overwrites or appends the
real client address as the rightmost `X-Forwarded-For` value. Set
`DEMO_CLIENT_IP_VERIFIED=true` in production only after verification. Spoofable
headers or a shared proxy address undermine the limit. Production proxy
behavior has not yet been verified; keep demo mode disabled until that and the
remaining deployment and cleanup work are complete.
The demo cleanup command is implemented but should not be scheduled until
demo creation and the remaining demo phases are complete. On production, use a
separate maintenance database identity, not the web application's database
user. Give that identity `SELECT` and `DELETE` on `account` and
`work_search_activities`, and `SELECT` and `UPDATE` on `demo_instances`.
These are table-wide privileges, so protect the credentials; the command
itself checks both the account kind and demo marker before deleting.

The wrappers in `scripts/cleanup-demo-local.sh` and
`scripts/cleanup-demo-production.sh` call the same guarded cleanup command. Both
require Node 22.18 or newer and an installed application dependency tree.
The local wrapper reads `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
`DB_ADMIN_USER`, and `DB_ADMIN_PASSWORD` from `.env.local`. It requires host
`127.0.0.1`, database `twc`, and an administrator distinct from the application
user. Administrator access is intended only for local testing; keep `.env.local`
private and never upload it to production.

For production, create a separate private environment file at
`/home/hoffma12/.config/twc/demo-cleanup.env`, outside public directories.
Restrict the file to the owning user (mode `0600`). Set
`DEMO_CLEANUP_DB_HOST`, `DEMO_CLEANUP_DB_PORT`, `DEMO_CLEANUP_DB_NAME`,
`DEMO_CLEANUP_DB_USER`, and `DEMO_CLEANUP_DB_PASSWORD`, as well as `DB_USER`
(the application database username, used to check that the cleanup user is
separate). These are Node environment files, not shell scripts. Verify the
production host and database before use. Do not put credentials in the
application archive, source control, or cron command.

Provision the production maintenance user and the grants above separately; the
wrappers do not create users or change privileges.

For manual local cleanup:

```sh
bash scripts/cleanup-demo-local.sh
```

For production, copy the production wrapper to a private location on the
hosting account. After deployment readiness and a manual non-production test,
invoke it with `/bin/bash` using its absolute installed path in cPanel cron.
The wrapper uses the production Node and project paths shown in the script;
verify them on the host. Configure cron output and failure monitoring rather
than discarding errors.

The command processes up to 50 ended or expired demos per run and reports the
remaining eligible count. Configure cPanel cron and monitor failures and
backlog before enabling demos; a successful cleanup does not erase backups.
When production dependencies change, upload `scripts/install-production.sh` to
`/home/hoffma12/twc` and run `bash install-production.sh` there in an InMotion
terminal. Restart the Node app through cPanel after the installation succeeds.
The document-root `.htaccess` should hold only the Passenger directives for
this Node app; leave out any legacy PHP rewrite rules.

## Pages

- `/` — welcome dashboard with links to Enter and Search.
- `/enter` — responsive work-search activity form with calendar date inputs,
  Job Source selection (LinkedIn, Indeed, or Other), a Job Source URL field
  for Other, state selection, phone mask, Clear, and Submit actions.
- `/search` — responsive, paginated list of all activities with selectable
  page sizes (10, 25, 50, or 100; default 10), a read-only details modal, and an edit
  modal for each record with the same Job Source controls, and a delete action
  with confirmation. Existing unrecognized Job Source values are shown as
  Other when editing; saving LinkedIn or Indeed clears the Job Source URL.
- `/export` — paginated activity selection with the same page sizes and default,
  cross-page checkboxes, a 10-activity selection limit, selected-record removal,
  and a print preview.
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

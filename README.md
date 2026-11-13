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
# Set DB_PASSWORD in .env.local to a random local-only password.
DB_ADMIN_USER=xxxx DB_ADMIN_PASSWORD='your-local-mysql-admin-password' pnpm db:setup
pnpm dev
```

The frontend is available directly at <http://127.0.0.1:5174> and through
Apache at <http://twc.local.com>. The API listens on `127.0.0.1:3002`; Vite
proxies `/api` requests to Express. `GET /api/health` checks API availability;
`GET /api/activities?page=1&pageSize=5` lists all activities and returns
pagination metadata. Page sizes of 5, 10, 25, 50, and 100 are supported; the
default is 5. `GET /api/activities` defaults to page 1 and page size 5.
`POST /api/activities` creates an activity; `PUT /api/activities/:id` updates
an existing activity. Database setup creates the `twc` schema and a `twc_app`
account with only `SELECT`, `INSERT`, and `UPDATE` access to the activity
table. The admin credentials are used only for the one-time setup command and
should not be saved in `.env.local` or committed.

Apache must be running to use the `twc.local.com` address. In this environment
it is started manually; if it is stopped, run
`sudo /opt/local/sbin/apachectl start`.

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

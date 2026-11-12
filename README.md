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
DB_ADMIN_USER=root DB_ADMIN_PASSWORD='your-local-mysql-admin-password' pnpm db:setup
pnpm dev
```

The frontend is available at <http://127.0.0.1:5174> and the API listens on
`127.0.0.1:3002`. The Vite development server proxies `/api` requests to the
Express API. `GET /api/health` checks API availability; `POST /api/activities`
creates an activity. Database setup creates the `twc` schema and an
insert-only `twc_app` account. The admin credentials are used only for the
one-time setup command and should not be saved in `.env.local` or committed.

## Pages

- `/` — welcome dashboard with links to Enter and Search.
- `/enter` — responsive work-search activity form with calendar date inputs,
  state selection, phone mask, Clear, and Submit actions.
- `/search` — Phase 2 placeholder.

The form submits to the local API and retains its values after both successful
and unsuccessful saves. `twc.local.com` Apache/hosts configuration remains
deferred to a later phase.

## Checks

```sh
pnpm lint
pnpm test
pnpm build
```

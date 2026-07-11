# Chorey

A self-hosted, single-purpose star-chart chore tracker. See
[README.md](README.md) for what it does and how to run it, and
[DESIGN.md](DESIGN.md) for the full data model, business logic, and API
reference. This file is about how to work in the codebase.

## Layout

Two separate npm packages, deployed as one Docker image:

- `server/` — Express 4 + `better-sqlite3` (synchronous, WAL mode) API. In
  production it also serves the built client from `public/` and falls back to
  `index.html` for any non-`/api` route (see `server/src/app.ts`). SQL
  migrations live in `server/src/db/migrations/*.sql` and run on boot
  (`server/src/db/migrate.ts`); the build step copies them into `dist/`.
- `client/` — React 18 + Vite + TypeScript SPA (React Router v6, Tailwind v3).
  The management interface and the Child Portal are both here.

All runtime config flows through `server/src/env.ts` (`PORT`, `DATA_DIR`,
`SESSION_SECRET`, `RP_ID`, `RP_NAME`, `ORIGIN`). The client talks to the API
with same-origin relative `/api` paths, so nothing in the client is tied to a
port; in dev, Vite proxies `/api` to the server (`client/vite.config.ts`).

## Auth model (don't break these invariants)

- Only **Parent** profiles have credentials (password and/or WebAuthn
  passkey). **Child** profiles have none — they're reached only via their
  per-child portal token.
- The `/api/portal` routes are intentionally **not** behind `requireAuth`
  (they're token-authenticated). Everything under `/api/chores` and
  `/api/users` requires a Parent session.
- WebAuthn `ORIGIN`/`RP_ID` must match the URL the browser actually hits, or
  passkey registration/login fails. Passkeys need a secure context
  (`https`, or `http://localhost`).

## Conventions

- Reuse `getErrorMessage(err: unknown)` (in `server/src/utils/errors.ts` and
  `client/src/api/client.ts`) instead of `catch (err: any)`.
- Wrap every `async` Express route handler in `asyncHandler()`
  (`server/src/utils/asyncHandler.ts`) so a rejected promise reaches Express's
  error handler instead of becoming an unhandled rejection.
- Validate request bodies with `zod` at the route boundary, matching the
  existing routes.
- `server/src/middleware/requireAuth.ts` augments Express's `Request` type via
  `declare global { namespace Express {} }` — that's the only way to do that
  augmentation; leave it.

## Commands

```bash
# server
cd server && npm run dev        # tsx watch on :5152 (or $PORT)
cd server && npm run build      # tsc + copy migrations into dist/
cd server && npm run typecheck  # tsc --noEmit

# client
cd client && npm run dev        # vite dev server, proxies /api
cd client && npm run build      # vite build → client/dist
cd client && npm run typecheck  # tsc --noEmit
```

`typecheck` must pass clean (zero errors) in both packages before considering
a change done — treat a type error like a failing build.

> Note: both packages declare `lint`/`lint:fix` scripts and ESLint
> devDependencies, but no `eslint.config.js` is checked in yet, so `npm run
> lint` currently has no config to run. If you add linting, add a flat
> `eslint.config.js` per package (type-aware `typescript-eslint` rules plus
> `eslint-config-prettier` last); the client also wants
> `eslint-plugin-react-hooks` and `eslint-plugin-react-refresh`.

## Database

A single SQLite file under `DATA_DIR` (`data/chores.db`, gitignored along with
its `-wal`/`-shm` sidecars). Back it up by copying the file. Schema changes go
in a new numbered migration (`NNNN_name.sql`) — migrations are applied in
filename order and are not re-run once recorded.

## Build versioning

`version.json` (repo root, `{year, month, build}`) is the single source of
truth for the app's build label — it's **committed, not gitignored**. The
server loads it once at startup (`server/src/version.ts`), exposes it at
`GET /api/version` as `{year, month, build, label}` where `label` is e.g.
`2026.07 Build 1`, and the client's `VersionBadge` component renders that
label in the corner.

It's **baked into the Docker image at build time** (`COPY version.json` in the
`Dockerfile`), not computed at runtime, so the label always matches exactly
what's running rather than what today's date would produce.

`.github/workflows/docker-build.yml` bumps and commits it automatically on
every push to `main` (not PRs), before the build/push steps, and pushes that
commit back to `main` with `[skip ci]` so it doesn't retrigger the workflow.
The build counter resets to `1` on month rollover.

This means a push to `main` is always followed by an automated version-bump
commit. **Pull before pushing again** (`git pull --rebase`) or a second push
right after the first will be rejected as non-fast-forward. If you have local
changes when that happens: `git stash && git pull --rebase && git stash pop`.

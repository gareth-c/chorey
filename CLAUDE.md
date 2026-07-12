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
- Sessions are opaque `nanoid(32)` tokens in an httpOnly cookie, looked up
  against the `sessions` table (30-day TTL) — not signed JWTs. `SESSION_SECRET`
  is unused for this reason; it's kept only as a placeholder.
- Since only Parents ever get a session, `req.user.role` is always `"parent"`
  wherever `requireAuth` has run. `requireRole("parent")` on write routes is
  defense in depth, not currently load-bearing — don't remove it on the
  assumption it's dead code.
- A logged-in Parent can register/remove a passkey for *any* Parent profile,
  including their own, via `/api/users/:id/passkey/*`. Attempting this against
  a Child profile 400s — enforced server-side in `requireParentTarget()`
  (`users.routes.ts`), not just by the UI hiding the buttons.
- `/api/auth/login` and `/api/auth/login/passkey/verify` are rate-limited
  (`express-rate-limit`, 10 attempts / 15 min per IP) — a deliberate fix for
  an online brute-force gap, don't strip it out when touching those routes.
  Per-IP keying depends on `app.set("trust proxy", env.trustProxy)` in
  `app.ts` (`TRUST_PROXY`, default 1 hop): without it, every client behind
  the reverse proxy shares one bucket and `express-rate-limit` v7 500s on
  the `X-Forwarded-For` mismatch.
- `ProfilePicker` (`client/src/pages/ProfilePicker.tsx`) behaves differently
  depending on whether `onCancel` is passed — that's how it tells `/login`
  apart from its embedded use as the Child Portal's "Parent sign-in" picker.
  In the portal context it's **passkey-only**: no password form even if
  `hasPassword`, and no credential-less auto-login even if a profile has
  neither credential. Don't reunify these paths — the whole point is that a
  screen a child has physical access to never offers the weaker methods.

## Chore business logic (don't break these invariants)

- **Period keys** (`chores/service.ts`'s `computePeriodKey`) govern only
  re-completion eligibility — `chore_completions` has
  `UNIQUE(chore_id, period_key)`, which is what makes "tap to complete"
  idempotent per day/week/month. They do **not** drive historical reporting;
  `sumStars()` sums by `completed_at` timestamp range instead. Don't conflate
  the two when changing either.
- **Weeks start Monday, end Sunday**, computed in the household's configured
  timezone (`app_settings.timezone`, IANA name, default `UTC`) via
  `chores/timezone.ts` — a small `Intl.DateTimeFormat`-based module, not a
  date library. Every "day start" / "week start" is independently re-derived
  from the target calendar date rather than by subtracting fixed millisecond
  offsets, so a DST transition inside a week doesn't skew results by an hour.
  Don't reintroduce raw `Date.UTC`/`getUTCDay()` math into `service.ts` — it
  bypasses the household timezone entirely.
- **`WeekSummary.threshold`**: the **current, still-open week** always uses
  the *live* `reward_rules.daily_star_goal` (so a goal change today applies
  immediately, not next Monday). **Completed weeks** are frozen to whatever
  `reward_rule_history` says was in effect on that week's Monday
  (`getEffectiveDailyGoal()`). Don't collapse this back to "always live" —
  that's the exact bug it was built to fix. `setRewardRule()` only inserts a
  new history row when the goal actually changes (or on the first goal for a
  child), not on every reward-text edit.
- How many past weeks render is `app_settings.history_weeks_shown`
  (default 4), not a hardcoded constant — configurable via `/api/settings`.
- `POST /api/import` (a `chore-export.json` from a previous version) always
  creates fresh children/chores rather than merging by name — importing the
  same file twice produces duplicates, intentionally.

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

On a PR, only the `build-pr` job runs: a single-platform (`linux/amd64`),
`push: false` build that never touches `version.json` or the registry — it
only has to prove the Dockerfile still builds.

On a push to `main`, four jobs run in sequence/parallel: `version` bumps and
pushes the `version.json` commit first; `build` then builds
`linux/amd64` and `linux/arm64` **each on its own native runner**
(`ubuntu-latest` / `ubuntu-24.04-arm`) and pushes each by digest, not by
tag; `merge` downloads both digests and assembles them into one multi-arch
manifest under `latest` + a short-sha tag via `docker buildx imagetools
create`. This is what makes `docker-compose.yml`'s pulled image resolve to
the right architecture on a Raspberry Pi or an ARM NAS.

**Don't reintroduce QEMU for the `linux/arm64` leg.** It was tried first
(`docker/setup-qemu-action` emulating arm64 on the `amd64` runner) and
reliably SIGILL-crashed partway through `npm install` — emulated Node.js's
V8 JIT hitting an instruction QEMU's translator gets wrong is a known,
effectively unfixable QEMU incompatibility for this kind of native-addon
build (`better-sqlite3`), not something a QEMU version bump resolves.
Native `ubuntu-24.04-arm` runners sidestep the problem entirely and are
free for public repos — that's why the per-platform builds are a runner
matrix instead of a single job with `platforms: linux/amd64,linux/arm64`.

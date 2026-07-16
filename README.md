# Chorey

<p align="center">
  <img src="docs/screenshots/dashboard-dark.png" alt="Chorey management interface — chores, reward rules, and weekly history" width="820">
</p>

<p align="center"><strong>Turn chores into a star chart your kids actually want to check.</strong></p>

Chorey is a self-hosted, single-purpose chore tracker for a household — no
accounts to create, no ads, no subscription, nobody's server holding your
kids' data. Parents run everything from a clean dashboard; kids get their own
no-login link on a shared tablet where tapping a finished chore is the whole
interaction. It's the kind of tool you set up once on a spare Raspberry Pi or
NAS and forget about — until the star chart becomes the thing your kids ask
to check before breakfast.

A few reasons it's worth the five minutes to try:

- **Nothing to explain.** Two screens, no per-kid accounts, no settings maze
  — one `docker compose up` and a setup wizard, and you have a working star
  chart (see below).
- **Built for the shared tablet, not around it.** The Child Portal is
  passkey-secured for parent sign-in, so a password never has to be typed on
  a screen the kids have all day.
- **Doesn't guess your history.** Weekly rewards are graded against the goal
  that was actually in effect that week, in your actual timezone — raise the
  bar today without quietly rewriting last week.
- **It's genuinely nice to look at.** Light and dark themes, both designed
  on purpose (screenshots below), not just default browser styling.
- **Your data stays yours.** One SQLite file, one Docker container, no
  third-party service in the loop.

It has two distinct surfaces:

- **Management interface** (`/app`) — Parent-only. Sign in, create chores
  (name, assignee, frequency, star value), delete them, manage Parent/Child
  profiles, set per-child reward rules, and generate Child Portal links.
  Nothing here is reachable without a Parent session.
- **Child Portal** (`/portal/:token`) — a no-login, per-child URL meant to
  live on a shared family tablet or a kid's phone. It shows only that child's
  chores; tapping one completes it immediately (no approval step). A small
  "Parent sign-in" link reveals the Parent picker, restricted to **passkey**
  login here (no password form, since it's a screen a child has physical
  access to), so a parent can switch into the management interface from the
  shared device.

Each chore is **daily**, **weekly**, or **monthly** — it can only be completed
again once the current period rolls over — and belongs to a **time of day**
(All Day, Morning, Afternoon, or Evening) that the parent sets. The Child
Portal groups a kid's chores under those headings, showing only the ones
that actually have chores in them. Both surfaces show a Monday–Sunday day
strip for the current week and a summary of past completed weeks (total
stars and whether the reward threshold was hit) — 4 weeks by default, and how
many is a household setting.

Day/week boundaries respect a configurable household timezone (defaults to
UTC), and a completed week's reward threshold is frozen to whatever the goal
was at the time — changing a child's daily goal only affects the current week
and weeks going forward, never rewrites history. Both are set from **Manage
users → Household settings**.

The whole app has both a light and a dark theme, switchable from a toggle in
the top-right corner — dark is the default.

See **[DESIGN.md](DESIGN.md)** for the full design reference: data model,
business logic (period keys, week math, the weekly-history algorithm), the API
reference, and the frontend component contracts.

## Screenshots

**Sign-in — "Who's managing?"**, in both themes:

<p align="center">
  <img src="docs/screenshots/login-dark.png" alt="Sign-in screen, dark theme" width="49%">
  <img src="docs/screenshots/login-light.png" alt="Sign-in screen, light theme" width="49%">
</p>

**Getting started** — the empty-state hero shown before any Child profile exists:

<p align="center">
  <img src="docs/screenshots/empty-state-dark.png" alt="Empty state prompting to add the first child" width="820">
</p>

**Management interface** — chores, reward rules with expandable weekly
history, and Child Portal links:

<p align="center">
  <img src="docs/screenshots/dashboard-dark.png" alt="Management dashboard with chores, reward rules, and history" width="820">
</p>

**Child Portal** — the no-login view a kid taps through on a shared tablet,
with today/this-week progress, a 7-day strip, and reward status:

<p align="center">
  <img src="docs/screenshots/portal-light.png" alt="Child Portal checklist, light theme" width="49%">
  <img src="docs/screenshots/portal-dark.png" alt="Child Portal checklist, dark theme" width="49%">
</p>

**Users** — profile management, passkeys, and importing a `chore-export.json`
from a previous version:

<p align="center">
  <img src="docs/screenshots/users-dark.png" alt="Users page with passkey management and import" width="820">
</p>

## Tech stack

- **Backend**: Node.js + TypeScript, Express 4, `better-sqlite3` (WAL mode),
  `zod`, `bcryptjs`, `@simplewebauthn/server` (passkeys), `nanoid`,
  `cookie-parser`, `express-rate-limit`.
- **Frontend**: React 18 + Vite + TypeScript, `react-router-dom` v6,
  Tailwind CSS v3 (class-based dark mode).
- **Packaging**: a single Docker image — Express serves the built React bundle
  as static files and the API from the same origin, running as a non-root
  user.

## Run with Docker

The app listens on **port 5152** and stores its SQLite database in a `data/`
volume. Every push to `main` publishes an image to the [GitHub Container
Registry](https://github.com/gareth-c/chorey/pkgs/container/chorey) at
`ghcr.io/gareth-c/chorey`, tagged `latest` — that's the fastest way to run
it, no local build required:

```bash
docker compose up -d       # pull ghcr.io/gareth-c/chorey:latest and start
docker compose logs -f     # follow logs
docker compose down        # stop
```

Then open <http://localhost:5152> — first run drops you into the setup wizard
to create the initial Parent account.

The published image is multi-arch (`linux/amd64` and `linux/arm64`) — it
runs as-is on a Raspberry Pi or an ARM-based NAS, no separate build needed.

To build the image from source instead (e.g. while working on the code),
use [`docker-compose-local-build.yml`](docker-compose-local-build.yml):

```bash
docker compose -f docker-compose-local-build.yml up -d --build
```

### Configuration

Copy `.env.example` to `.env` (next to `docker-compose.yml`) and adjust:

| Variable         | Default                   | Notes                                                         |
| ---------------- | ------------------------- | ------------------------------------------------------------- |
| `PORT`           | `5152`                    | Port the server listens on (and the published container port).|
| `TRUST_PROXY`    | `1`                       | Reverse-proxy hops in front of the app. `1` fits the usual single HTTPS proxy; `0` if browsers hit Node directly. Needed for login rate limiting to see real client IPs. |
| `SESSION_SECRET` | `change-me-in-production` | **Set a real one** — e.g. `openssl rand -hex 32`.             |
| `RP_ID`          | `localhost`               | WebAuthn relying-party ID (a hostname, no scheme/port).       |
| `RP_NAME`        | `Chorey`                  | Name shown in the passkey prompt.                             |
| `ORIGIN`         | `http://localhost:5152`   | Must match the URL the browser hits, for WebAuthn.            |

**Passkeys** only work in a secure context — `https` on a real domain, or
`http://localhost`. Over a plain `http://<lan-ip>:5152` URL (e.g. a shared
tablet on the LAN), the Child Portal's embedded "Parent sign-in" picker is
passkey-only, so it won't be usable there at all — sign in from `/login`
directly on that device instead, which still supports a password. To use
passkeys everywhere, including the shared-device picker, put the app behind
HTTPS and set `RP_ID`/`ORIGIN` to that real hostname.

## Local development

`server/` and `client/` are separate npm packages.

```bash
# terminal 1 — API on :5152
cd server && npm install && npm run dev

# terminal 2 — Vite dev server (proxies /api to :5152)
cd client && npm install && npm run dev
```

## Repository layout

```
server/                          Express + better-sqlite3 API; also serves the built client in prod
client/                          React + Vite single-page app (management interface + Child Portal)
Dockerfile                       multi-stage build (client build → server build → runtime)
docker-compose.yml               pulls the published ghcr.io image, publishes 5152, mounts ./data
docker-compose-local-build.yml   same, but builds the image from source instead of pulling
DESIGN.md                        full design + API reference
SECURITY.md                      how to report a vulnerability
```

## Security

Found a vulnerability? Please don't open a public issue — see
[SECURITY.md](SECURITY.md) for how to report it privately.

# Chorey — standalone extraction design doc

This document plus the `source/` folder next to it are a self-contained
handoff package: everything a fresh Claude Code session (in a **new, empty
repo**) needs to stand up Chorey as its own small app, without access
to the Homey monorepo it was extracted from.

Read this doc first, then use `source/` as the literal starting file tree —
it's not pseudocode, it's real TypeScript/SQL adapted to drop the
Homey-specific plumbing (plugin registry, multi-plugin nav shell, backup
system) while keeping every piece of Chorey's own logic byte-for-byte
identical to what's running in production today.

## 1. What this app does

A star-chart chore tracker for a household, split across **two distinct
surfaces** rather than one role-branching app:

- **The management interface** (`/app`) — Parent-only. This *is* the web
  app in the traditional sense: sign in, create chores (name, assignee,
  frequency, star value), delete them, manage Parent/Child profiles, set
  per-child reward rules, and generate Child Portal links. Nothing here is
  reachable without a Parent session.
- **The Child Portal** (`/portal/:token`) — a no-login, per-child URL meant
  to live on a shared family tablet or a kid's own phone/browser bookmark.
  It shows only that child's own chores; tapping one completes it
  immediately, no parent approval step. It also has a small, deliberately
  unobtrusive **"Parent sign-in"** link that reveals the same Parent picker
  used at `/login`, so a parent can switch into the management interface
  from the shared device itself rather than needing a second URL or device.
  That picker supports both password and **passkey** login — passkeys are
  the better fit for this specific spot, since it's a screen a child has
  physical access to and a typed password can be watched or guessed.

Each chore can be **daily**, **weekly**, or **monthly** — completing it
again is only possible once the current period rolls over. Everyone (a
parent viewing a child's card in the management interface, or the child
themselves in the Portal) can see:
- a **Monday–Sunday day strip** for the current week, with future days
  greyed out
- a **previous-weeks summary**: the last 4 completed weeks (each ending
  Sunday), total stars, and whether the reward threshold was hit

## 2. Scope: what's carried over vs. dropped

This app needs *some* multi-user concept — chores are assigned to specific
children, and only parents can manage them — so full auth isn't optional.
Passkey support is *in scope* here (unlike a first pass at this extraction,
which dropped it) specifically because of the Child Portal's parent-picker:
a shared, kid-accessible screen is exactly the situation passkeys are good
at securing, better than a password that can be shoulder-surfed. Everything
else Homey-specific is still left behind.

**Carried over (verbatim or near-verbatim):**
- `users` table (parent/child roles) + session auth, **with password and
  WebAuthn/passkey support restricted to Parent profiles** — Child profiles
  have no credentials at all; they're reached only via their portal token
  (see §5.1)
- All of Chorey's own logic: schema, service functions, routes,
  portal routes, every React component
- The visual language: Tailwind + the same `brand` color scale and
  `.input`/`.btn-primary`/`.btn-secondary`/`.btn-danger` utility classes,
  so it looks like a sibling app, not a fork with a different skin

**Dropped (not needed for a single-purpose app):**
- The plugin registry (`server/src/plugins/registry.ts`,
  `config/plugins.json`, the enabled/disabled toggle system) — Chore
  Tracker's routes are mounted directly instead of dynamically discovered
- Backup & Restore (scheduled zip backups, restore-on-blank-install) — out
  of scope for v1. A single SQLite file is easy to back up by just copying
  it; revisit if this app grows enough to warrant it
- House Details, Bill Manager, Policy Tracker, and the multi-plugin sidebar
  shell (`AppShell.tsx`) — this app has exactly two screens (management
  interface, Child Portal), so it doesn't need a plugin nav at all

## 3. Tech stack

Same as Homey, because Chorey's code was written against it and
there's no reason to introduce risk translating to something else:

- **Backend**: Node.js + TypeScript, Express 4, `better-sqlite3` (synchronous
  SQLite, WAL mode), `zod` for request validation, `bcryptjs` for password
  hashing, `@simplewebauthn/server` for passkeys, `nanoid` for IDs and
  tokens, `cookie-parser` for session cookies
- **Frontend**: React 18 + Vite + TypeScript, `react-router-dom` v6, Tailwind
  CSS v3
- **Packaging**: single Docker image (Express serves the built React bundle
  as static files + the API from the same origin, same as Homey) — see §8

## 4. Data model

```sql
-- users: the only "who can do what" concept this app needs. Child rows
-- never get a password_hash or webauthn_credentials row — enforced at the
-- route layer (users.routes.ts), not by a schema constraint, since SQLite
-- can't express "NULL unless role = 'child'" declaratively.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_emoji TEXT NOT NULL DEFAULT '🙂',
  role TEXT NOT NULL CHECK (role IN ('parent', 'child')),
  password_hash TEXT,                    -- NULL = no password set (Parent can still use a passkey)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- Passkeys — Parent profiles only (see §5.1).
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Short-lived WebAuthn challenge storage, one row per in-flight
-- registration/authentication ceremony.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Chorey's own tables — unchanged from Homey.
CREATE TABLE IF NOT EXISTS chores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  assigned_to TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  stars INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chore_completions (
  id TEXT PRIMARY KEY,
  chore_id TEXT NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,              -- e.g. '2026-07-09' (daily), week-start date (weekly), '2026-07' (monthly)
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(chore_id, period_key)           -- one completion per chore per cadence period = the toggle's idempotency key
);

CREATE TABLE IF NOT EXISTS reward_rules (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  daily_star_goal INTEGER NOT NULL DEFAULT 0,   -- 0 = not configured
  weekly_reward TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS portal_links (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,            -- the Child Portal URL's bearer credential
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Split across `source/server/src/db/migrations/0001_init.sql` (users +
sessions), `0002_chore_tracker.sql` (chores/completions/reward
rules/portal links), and `0003_webauthn.sql` (the two passkey tables above),
applied by a tiny numbered-migration runner (`db/migrate.ts`) — same pattern
as Homey, copied as-is since it's fully generic.

**Important nuance carried over as-is**: `weekly_threshold` isn't stored per
week — it's always `reward_rules.daily_star_goal × 7`, the *current* rule.
Historical week summaries (§6) apply today's threshold retroactively rather
than whatever the goal was at the time. This matches Homey's behavior and is
a deliberate simplification, not an oversight — worth flagging if a future
session wants to "fix" it, since doing so would mean storing a threshold
snapshot per week, which is a real (if small) schema change.

## 5. Backend architecture

```
server/src/
  env.ts                    # port, data dir, session secret, RP_ID/RP_NAME (passkeys), origin
  db/
    client.ts                # better-sqlite3 connection, WAL mode
    migrate.ts                # runs migrations/*.sql once, tracked in _migrations
    migrations/
      0001_init.sql
      0002_chore_tracker.sql
      0003_webauthn.sql
  auth/
    password.ts               # bcrypt hash/verify
    session.ts                 # cookie-based session create/destroy/lookup
    webauthn.ts                 # passkey registration/authentication ceremonies (@simplewebauthn/server)
  middleware/
    requireAuth.ts             # 401 if no valid session cookie
    requireRole.ts              # 403 unless req.user.role is in the allowed list
  utils/
    asyncHandler.ts             # wraps async route handlers so rejections reach Express's error handler
    errors.ts                    # getErrorMessage(err: unknown): string
  routes/
    auth.routes.ts               # Parent profiles list, setup (first parent), login (password + passkey), logout
    users.routes.ts               # parent-only: create/edit/delete users, set/clear password, register/remove passkeys
    portal.routes.ts               # PUBLIC, no requireAuth — token-authenticated Child Portal
  chores/
    service.ts                     # all business logic (below) — pure, no Express types
    routes.ts                       # thin Express layer over service.ts
  app.ts                             # wires routers + static file serving
  index.ts                            # runs migrations, starts the HTTP server
```

### 5.1 Auth model

Two things make this different from a typical single-login app: only
Parents ever get a session, and Parents can authenticate with a password,
a passkey, or both.

- `GET /api/auth/profiles` → `{ needsSetup, profiles: [{id, name, avatarEmoji, role, hasPassword, hasPasskey}] }`,
  **filtered to `role = 'parent'`** — this is the list the management
  interface's login picker (and the Child Portal's embedded parent picker,
  see §6.3) renders. `needsSetup` is true iff `users` is empty (checked
  unfiltered — the very first user created is always a Parent, via
  `/setup`) — the client shows a "create the first Parent" form instead of
  a profile picker in that case.
- `POST /api/auth/setup` → creates the first Parent (only works while
  `needsSetup` is true; 409 otherwise).
- `POST /api/auth/login` with `{userId, password?}` → `userId` must resolve
  to a Parent (child IDs 404). If the profile has no `password_hash`,
  `password` is ignored and login succeeds outright; if it does, `password`
  must match.
- `POST /api/auth/login/passkey/options` with `{userId}` → generates a
  WebAuthn authentication challenge for that Parent (400 if they have no
  registered passkey). `POST /api/auth/login/passkey/verify` with
  `{userId, response}` → verifies the browser's assertion and, on success,
  creates a session exactly like the password path.
- `POST /api/auth/logout`, `GET /api/auth/session` → `{user: SessionUser | null}`.
- Session = a `nanoid(32)` token in an httpOnly cookie, looked up against the
  `sessions` table (30-day TTL, same as Homey). `requireAuth` populates
  `req.user` from it; since only Parents ever reach this point,
  `req.user.role` is always `"parent"` for any authenticated request —
  `requireRole("parent")` is kept on the write routes anyway as defense in
  depth, not because it's currently doing load-bearing work.

**Passkey management** (`users.routes.ts`, Parent-only targets): a logged-in
Parent registers a passkey for *any* Parent profile (including their own)
via `POST /api/users/:id/passkey/register/options` →
`@simplewebauthn/browser`'s `startRegistration()` in the client →
`POST /api/users/:id/passkey/register/verify`. `DELETE /api/users/:id/passkey`
removes all of that profile's credentials. Attempting any of this against a
Child profile is a 400 — Child profiles categorically don't get credentials,
enforced in `users.routes.ts`'s `requireParentTarget()` helper, not just by
the UI hiding the buttons.

**Secure context caveat**: like any WebAuthn setup, passkeys only work over
`https://` or `http://localhost` — never over a plain `http://<lan-ip>:PORT`
URL. If the Child Portal is opened over LAN IP on a shared tablet (the
common case), the "Parent sign-in" picker's passkey button won't be usable
there even though the tablet *can* see it; password login still works.
Put this app behind a reverse proxy with HTTPS (see §8) to get passkeys
working from every device, not just `localhost`.

### 5.2 Chore business logic (`chores/service.ts`)

This is the part worth reading closely — it's the one file with real logic,
everything else is CRUD plumbing. All dates are handled in **UTC**
throughout (no per-user timezone support — a deliberate simplification
carried over from Homey; a future session could add a `timezone` column on
`users` and thread it through if that ever matters).

**Period keys** — what makes the "can't complete a chore twice in the same
period" rule work:

```ts
function computePeriodKey(frequency: Frequency, now: Date): string {
  if (frequency === "daily") return toDateKey(now);              // '2026-07-09'
  if (frequency === "weekly") return toDateKey(getWeekStart(now)); // that week's Monday
  return toMonthKey(now);                                          // '2026-07'
}
```

`toggleCompletion(choreId)` looks up `chore_completions` by
`(chore_id, period_key)` for *today's* computed key. If a row exists, delete
it (un-complete); if not, insert one. This makes "tap to complete" naturally
idempotent per period without any separate "already done" flag to keep in
sync.

**Week start = Monday**, always:

```ts
function getWeekStart(d: Date): Date {
  const day = d.getUTCDay();        // 0=Sun..6=Sat
  const diffToMonday = (day + 6) % 7;
  const start = startOfUTCDate(d);
  start.setUTCDate(start.getUTCDate() - diffToMonday);
  return start;
}
```

So a week always runs Monday 00:00 UTC through the following Monday 00:00
UTC (exclusive) — i.e. it **ends on Sunday**, which is what the weekly
history feature (§2, most recently added to Homey) depends on.

**Weekly history** — the day-strip + previous-weeks summary:

```ts
export interface DayStars {
  date: string;       // 'YYYY-MM-DD'
  stars: number;
  isToday: boolean;
  isFuture: boolean;  // true for days later in the current week that haven't happened yet
}

export interface WeekSummary {
  weekStart: string;  // Monday, 'YYYY-MM-DD'
  weekEnd: string;    // Sunday, 'YYYY-MM-DD'
  stars: number;
  threshold: number;         // today's reward_rules.daily_star_goal * 7 (see the nuance in §4)
  rewardEarned: boolean;
  isCurrent: boolean;
  days: DayStars[];   // always 7 entries, Monday first
}

const PAST_WEEKS_SHOWN = 4;

function computeWeeklyHistory(userId: string, weeklyThreshold: number): WeekSummary[] {
  const now = new Date();
  const today = startOfUTCDate(now);
  const currentWeekStart = getWeekStart(now);

  const weeks: WeekSummary[] = [];
  for (let i = 0; i <= PAST_WEEKS_SHOWN; i++) {
    const weekStartDate = new Date(currentWeekStart.getTime() - i * 7 * 86400000);
    const weekEndDate = new Date(weekStartDate.getTime() + 6 * 86400000);

    const days: DayStars[] = [];
    for (let d = 0; d < 7; d++) {
      const dayDate = new Date(weekStartDate.getTime() + d * 86400000);
      const isFuture = dayDate > today;
      const stars = isFuture ? 0 : sumStars(userId, dayStartTs(dayDate), dayEndTs(dayDate));
      days.push({ date: toDateKey(dayDate), stars, isToday: sameDay(dayDate, today), isFuture });
    }

    const weekStars = sumStars(userId, weekStartTs(weekStartDate), weekEndTs(weekStartDate));
    weeks.push({
      weekStart: toDateKey(weekStartDate),
      weekEnd: toDateKey(weekEndDate),
      stars: weekStars,
      threshold: weeklyThreshold,
      rewardEarned: weeklyThreshold > 0 && weekStars >= weeklyThreshold,
      isCurrent: i === 0,
      days,
    });
  }
  return weeks; // newest first: weeks[0] is the current, in-progress week
}
```

`sumStars(userId, start, end)` is a single SQL query joining
`chore_completions` to `chores` and summing `stars` for completions in
`[start, end)` — this is what actually answers "how many stars on this day /
in this week," independent of `period_key` (which only governs re-completion
eligibility, not historical reporting).

`computeProgress(userId)` (the existing "today / this week" tracker) now
also calls `computeWeeklyHistory` and returns it as a `weeks` field — so
every place that already returned `Progress` (reward-rules endpoint, the
toggle endpoint, the portal endpoint) picked up the weekly history for free,
no new routes needed. Worth preserving that pattern in the standalone app
rather than adding a parallel `/history` endpoint.

### 5.3 API reference

All `/api/chores/*` and `/api/users/*` routes require a valid session
(`requireAuth` is applied once, at the router mount point, not per-route) —
and since only Parents ever get a session (§5.1), "parent" and "session" are
effectively the same precondition throughout this app. `/api/portal/*`
routes are deliberately public — the token in the URL *is* the credential.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/auth/profiles` | none | Parent profiles only |
| POST | `/api/auth/setup` | none, but 409 once `users` is non-empty | creates first Parent |
| POST | `/api/auth/login` | none | `{userId, password?}`, `userId` must be a Parent |
| POST | `/api/auth/login/passkey/options` | none | `{userId}` → WebAuthn authentication challenge |
| POST | `/api/auth/login/passkey/verify` | none | `{userId, response}` → creates session on success |
| POST | `/api/auth/logout` | session | |
| GET | `/api/auth/session` | none | `{user: SessionUser \| null}` |
| GET | `/api/users` | parent | list all profiles (Parent + Child) |
| POST | `/api/users` | parent | create a profile; `password` only accepted when `role: "parent"` |
| PUT | `/api/users/:id` | parent | edit name/avatar/role |
| DELETE | `/api/users/:id` | parent | can't delete yourself |
| POST | `/api/users/:id/password` | self or parent, **target must be a Parent** | set password |
| DELETE | `/api/users/:id/password` | self or parent, **target must be a Parent** | clear password |
| POST | `/api/users/:id/passkey/register/options` | self or parent, **target must be a Parent** | → WebAuthn registration challenge |
| POST | `/api/users/:id/passkey/register/verify` | self or parent, **target must be a Parent** | `{response}` → saves the credential |
| DELETE | `/api/users/:id/passkey` | self or parent, **target must be a Parent** | removes all of that profile's passkeys |
| GET | `/api/chores` | parent | all chores (children never call this — see §1) |
| POST | `/api/chores` | parent | `{name, assignedTo, frequency, stars}` |
| PUT | `/api/chores/:id` | parent | same body as POST |
| DELETE | `/api/chores/:id` | parent | |
| POST | `/api/chores/:id/toggle` | parent | returns `{completed, progress}` — Child completions go through `/api/portal/*` instead |
| GET | `/api/chores/reward-rules` | parent | array with one entry per Child |
| PUT | `/api/chores/reward-rules/:userId` | parent | `{dailyStarGoal, weeklyReward}` |
| GET | `/api/chores/links` | parent | each child's Child Portal URL (or null if never generated) |
| POST | `/api/chores/links/:userId/regenerate` | parent | invalidates the old URL |
| GET | `/api/portal/:token` | **none** | `{child, chores, progress}` — 404 on bad/revoked token |
| POST | `/api/portal/:token/chores/:choreId/toggle` | **none** | 403 if the chore isn't assigned to that token's user |

`Progress` (returned by the toggle endpoint, the reward-rules endpoint, and
the portal endpoint) shape:

```ts
interface Progress {
  starsToday: number;
  dailyGoal: number;
  starsThisWeek: number;
  weeklyThreshold: number;
  weeklyReward: string;
  rewardEarned: boolean;
  weeks: WeekSummary[]; // see §5.2 — weeks[0] is the current week
}
```

## 6. Frontend architecture

```
client/src/
  main.tsx                    # BrowserRouter + AuthProvider + <App/>
  App.tsx                      # routes: /login, /app, /app/users, /portal/:token
  index.css                     # Tailwind directives + .input/.btn-* component classes
  api/
    client.ts                    # fetch wrapper (credentials: 'include'), typed api.get/post/put/delete
  context/
    AuthContext.tsx               # current user + refresh()/logout()
    useAuth.ts                     # the hook (split out for Fast Refresh, same as Homey)
  components/
    ProfileCard.tsx                # one tile in the profile picker
  pages/
    ProfilePicker.tsx               # Parent login screen — password and/or passkey. Reused, embedded,
                                      # as the Child Portal's "parental user picker" (see §6.3); an
                                      # optional `onCancel` prop renders a "← Back" link in that context.
    SetupWizard.tsx                  # first-run: create the first Parent
    Dashboard.tsx                     # the management interface — Parent-only, no role branch needed
    Users.tsx                          # the management interface's user admin: create/delete Parent +
                                         # Child profiles, set passwords, register/remove passkeys
    ChildPortal.tsx                     # standalone, token-authenticated — NOT under AuthContext for
                                          # its data fetching, but mounts <ProfilePicker> as a takeover
                                          # overlay when "Parent sign-in" is tapped (see §6.3)
  chores/
    ChoreChecklist.tsx                 # presentational: a child's chores + progress. Used by
                                         # ChildPortal.tsx — the Portal always matches what a parent
                                         # sees for that child because they share this component.
    WeeklyHistory.tsx                   # presentational: day strip + previous-weeks list.
                                         # Used inside ChoreChecklist AND standalone in Dashboard.tsx
                                         # (behind a "Show history" toggle per child).
```

### 6.1 Component contracts

`ChoreChecklist` (`client/src/chores/ChoreChecklist.tsx`) — the shared
child-facing view:

```ts
interface ChoreItem {
  id: string;
  name: string;
  frequency: "daily" | "weekly" | "monthly";
  stars: number;
  doneThisPeriod: boolean;
}
interface ChoreProgress {
  starsToday: number;
  dailyGoal: number;
  starsThisWeek: number;
  weeklyThreshold: number;
  weeklyReward: string;
  rewardEarned: boolean;
  weeks: WeekSummary[];
}
// props: { childName, avatarEmoji, chores: ChoreItem[], progress: ChoreProgress, onToggle: (choreId: string) => void }
```

It has **no data-fetching of its own** — both call sites own their fetch
loop and pass data + an `onToggle` callback down. That's what makes it safe
to reuse for the token-authenticated Child Portal without leaking session-based
fetch logic into a public page.

`WeeklyHistory` (`client/src/chores/WeeklyHistory.tsx`) takes just
`{ weeks: WeekSummary[] }` and renders:
1. A 7-cell grid (Mon…Sun) for `weeks[0]`, greying out `isFuture` days and
   highlighting `isToday`.
2. `weeks.slice(1)` as a list of past-week rows: date range, total stars vs.
   threshold, and a 🎉 marker when `rewardEarned`.

### 6.2 Auth flow

`ProfilePicker` fetches `/auth/profiles` (Parent-only, per §5.1). If
`needsSetup`, it renders `SetupWizard` instead. Otherwise it shows a grid of
`ProfileCard`s; clicking one with neither a password nor a passkey logs in
immediately, clicking one with either reveals an inline panel: a "Use
passkey" button (only shown if `hasPasskey` and the browser supports
WebAuthn) and/or a password form (only shown if `hasPassword`). On success,
`AuthContext.refresh()` is called and the router navigates to `/app`.

`App.tsx` (trimmed from Homey's multi-plugin version):

```tsx
export default function App() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading && !location.pathname.startsWith("/portal/")) {
    return <div className="flex h-screen items-center justify-center text-slate-400">Loading…</div>;
  }
  return (
    <Routes>
      <Route path="/portal/:token" element={<ChildPortal />} />
      <Route path="/login" element={user ? <Navigate to="/app" replace /> : <ProfilePicker />} />
      <Route path="/app" element={user ? <Dashboard /> : <Navigate to="/login" replace />} />
      <Route path="/app/users" element={user ? <Users /> : <Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to={user ? "/app" : "/login"} replace />} />
    </Routes>
  );
}
```

`Dashboard.tsx` is the management interface's home screen: chore CRUD,
reward rules (with a per-child "Show history" toggle rendering
`WeeklyHistory`), and Child Portal links, plus a "Manage users" link to
`Users.tsx`. No role branch — every session here is a Parent.

### 6.3 Child Portal flow

`ChildPortal.tsx` reads `:token` from the URL, calls `GET /api/portal/:token`
(no cookie needed — the fetch wrapper always sends `credentials: 'include'`
but the portal routes never check for one), and renders `ChoreChecklist`.
Tapping a chore calls `POST /api/portal/:token/chores/:choreId/toggle` and
reloads. This route lives outside `AuthContext`'s data-fetching entirely —
it's mounted at the top level in `App.tsx`, reachable regardless of login
state.

A small "Parent sign-in" button sits fixed in the corner of the page. Tapping
it swaps the whole view for `<ProfilePicker onCancel={...} />` rendered as a
full-screen overlay — the *same* component and the *same* `/auth/profiles`
(Parent-only) data as `/login` uses, not a separate implementation. On
successful login, `ProfilePicker`'s own `completeLogin()` calls
`useAuth().refresh()` and `navigate("/app")` exactly as it does from the
`/login` route — that works from inside the overlay too, since it's still
within the app's single `<AuthProvider>`/`<BrowserRouter>` tree, just
rendered on top of the portal instead of routed to. `onCancel` closes the
overlay and returns to the child's checklist without signing in anywhere.

## 7. Styling system

Tailwind v3, with one custom color scale (`brand`, a blue) and four
component classes layered in `index.css`, reused verbatim so the standalone
app matches Homey's look without redesigning anything:

```js
// tailwind.config.js — theme.extend.colors.brand
{ 50: "#f2f6ff", 100: "#e3ecff", 200: "#c4d6ff", 300: "#9bb6ff", 400: "#6d8dff",
  500: "#4a66f5", 600: "#3548d6", 700: "#2b39ab", 800: "#252f86", 900: "#212a69" }
```

```css
/* index.css @layer components */
.input          /* rounded border input, brand-colored focus ring */
.btn-primary    /* solid brand-600 button */
.btn-secondary  /* white button, slate border */
.btn-danger     /* small red-text button, used for delete actions */
```

Full file is in `source/client/src/index.css` — copy it as-is.

## 8. Infra

**Ports & env vars** (see `source/server/src/env.ts`):

| Var | Default | Notes |
|---|---|---|
| `PORT` | `4100` | picked to not collide with Homey's `5052` if run side-by-side during development |
| `DATA_DIR` | `./data` | where `chores.db` (+ WAL/SHM) lives |
| `SESSION_SECRET` | insecure dev default | not actually used for cookie signing today (sessions are opaque DB-backed tokens, not signed JWTs) — kept for parity with Homey and as a placeholder if that ever changes |
| `RP_ID` | `localhost` | WebAuthn Relying Party ID — must match the domain the app is served from for passkeys to work; see the secure-context caveat in §5.1 |
| `RP_NAME` | `Chorey` | display name shown by the OS passkey prompt during registration |
| `ORIGIN` | `http://localhost:4100` | used to build the Child Portal URL returned by `/api/chores/links`, and must match the origin WebAuthn ceremonies are verified against |

**Docker**: same multi-stage pattern as Homey — build the Vite client,
build the TS server, copy both plus `node_modules` (prod only) into a
`node:20-alpine` runtime image, serve the client build as static files from
the same Express process that serves the API. `data/` is a bind-mounted
volume so the SQLite file survives container restarts/rebuilds.

```yaml
# docker-compose.yml
services:
  chorey:
    build: .
    ports: ["4100:4100"]
    volumes:
      - ./data:/app/data
    environment:
      - SESSION_SECRET=${SESSION_SECRET:-change-me-in-production}
      - RP_ID=${RP_ID:-localhost}
      - ORIGIN=${ORIGIN:-http://localhost:4100}
    restart: unless-stopped
```

Passkeys need a real HTTPS origin (or `localhost`) to work at all — see the
secure-context caveat in §5.1. Put a reverse proxy (Caddy, Traefik, Nginx +
Let's Encrypt) in front of this for production if you want the Child
Portal's "Parent sign-in" passkey option to work from devices other than
`localhost`; set `RP_ID`/`ORIGIN` to match that domain.

## 9. Bootstrapping the new repo

1. `mkdir chorey && cd chorey && git init`
2. Copy `source/server/` → `./server/`, `source/client/` → `./client/`
   verbatim — every file in there is meant to be used as-is, not as a
   reference to retype.
3. `cd server && npm install` (this pulls in the `better-sqlite3` native
   build — same Node 20 requirement as Homey; use `--ignore-scripts` for a
   quick local typecheck if the native compile is inconvenient on your
   machine, and let Docker's `node:20-alpine` stage do the real build).
4. `cd ../client && npm install`
5. Add `Dockerfile` + `docker-compose.yml` (§8) and a root `package.json`
   with `lint`/`format` scripts if you want the same ESLint + Prettier setup
   Homey uses — not copied here since it's generic tooling config, not part
   of Chorey's logic. Fastest path: copy `eslint.config.js` from
   Homey's `server/` and `client/` folders and `.prettierrc.json` from the
   repo root, unchanged.
6. `npm run dev` in both `server/` and `client/` (client proxies `/api` to
   `http://localhost:4100`, same as Homey's `vite.config.ts` — copied as-is
   in `source/client/vite.config.ts`).
7. Visit the client dev URL, walk through `SetupWizard` to create the first
   Parent, then go to Manage users to add a Child. Add a chore, generate a
   Child Portal link, and open it in a fresh browser context (no cookies) —
   confirm it loads that child's chores with no login, tapping toggles them,
   and the weekly history renders correctly there and in Dashboard's
   per-child "Show history" view.
8. From the Child Portal, tap "Parent sign-in," confirm the picker only
   lists Parent profiles, and confirm a password login there lands you back
   in the management interface at `/app`. Register a passkey for the Parent
   from Manage users, then repeat this from a fresh browser context using
   "Use passkey" instead — note this only works over `https://` or
   `http://localhost` (§5.1).
9. Confirm a Child profile can't be given a password or passkey — both the
   Add-profile form (password field hidden for role: child) and the API
   (`POST /users` 400s if `password` is set with `role: "child"`) should
   refuse it.

## 10. Open decisions for the next session

These are genuine judgment calls, not things I already decided on your
behalf — flagging them explicitly rather than burying a choice in code:

- **Password vs. passkey on the Child Portal's parent picker**: both are
  currently offered there, same as at `/login` — `ProfilePicker` doesn't
  distinguish where it's rendered. If a family wants the shared-device
  picker to be *stricter* than the direct-device one (e.g. passkey-only, no
  password fallback, since a password is more exposed on a kid-accessible
  screen), that's a real tightening to make deliberately, not something
  assumed here — it'd mean passing a flag into `ProfilePicker` to hide the
  password form when `onCancel` is set (i.e. when it's being used as the
  portal's embedded picker).
- **Historical reward thresholds**: `WeekSummary.threshold` always reflects
  *today's* reward rule, not what it was when that week happened (§4). Fine
  for a family that rarely changes the goal; worth storing a snapshot if
  that assumption stops holding.
- **Timezone**: everything is UTC day/week boundaries. A family that cares
  about exact midnight cutoffs in their local timezone would need a
  `timezone` column on `users` threaded through `service.ts`'s date math.
- **How many past weeks to show**: hardcoded to 4 (`PAST_WEEKS_SHOWN` in
  `chores/service.ts`). Trivial to make configurable if useful.

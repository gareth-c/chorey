# Chorey — design reference

The full design reference for Chorey: data model, business logic, API
reference, and frontend component contracts. See [README.md](README.md) for
what the app does and how to run it, and [CLAUDE.md](CLAUDE.md) for
conventions and invariants to keep in mind while working in the codebase.

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
  In this embedded context that picker restricts sign-in to **passkey
  only** — no password form — since it's a screen a child has physical
  access to and a typed password can be watched or guessed.

Each chore can be **daily**, **weekly**, or **monthly** — completing it
again is only possible once the current period rolls over. Everyone (a
parent viewing a child's card in the management interface, or the child
themselves in the Portal) can see:
- a **Monday–Sunday day strip** for the current week, with future days
  greyed out
- a **previous-weeks summary**: the last 4 completed weeks (each ending
  Sunday), total stars, and whether the reward threshold was hit

## 2. Tech stack

- **Backend**: Node.js + TypeScript, Express 4, `better-sqlite3` (synchronous
  SQLite, WAL mode), `zod` for request validation, `bcryptjs` for password
  hashing, `@simplewebauthn/server` for passkeys, `nanoid` for IDs and
  tokens, `cookie-parser` for session cookies, `express-rate-limit` on the
  login endpoints
- **Frontend**: React 18 + Vite + TypeScript, `react-router-dom` v6, Tailwind
  CSS v3 (class-based dark mode, light theme as the opt-in alternative)
- **Packaging**: single Docker image — Express serves the built React bundle
  as static files plus the API from the same origin, running as a non-root
  user (see §8)

## 3. Data model

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

-- Passkeys — Parent profiles only (see §4.1).
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

-- Household-level settings. Singleton row (id is always 1) — one household per install.
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  timezone TEXT NOT NULL DEFAULT 'UTC',           -- IANA name, e.g. 'America/New_York'
  history_weeks_shown INTEGER NOT NULL DEFAULT 4  -- past (completed) weeks to include, beyond the current one
);

-- One row per change to a child's daily_star_goal, so a past week's reward
-- threshold can reflect what the goal was *when that week happened* instead
-- of always applying today's goal retroactively (see the nuance below).
CREATE TABLE IF NOT EXISTS reward_rule_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  daily_star_goal INTEGER NOT NULL,
  effective_from TEXT NOT NULL,          -- 'YYYY-MM-DD', the date this goal took effect
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Split across `server/src/db/migrations/0001_init.sql` (users + sessions),
`0002_chore_tracker.sql` (chores/completions/reward rules/portal links),
`0003_webauthn.sql` (the two passkey tables above), `0004_settings.sql`
(`app_settings`), and `0005_reward_rule_history.sql` (`reward_rule_history`,
backfilled for existing rows — see the nuance below), applied by a tiny
numbered-migration runner (`db/migrate.ts`).

**Important nuance**: `WeekSummary.threshold` (§4.2) is **not** simply "today's
goal" anymore, but it isn't a full historical snapshot either — the split is
deliberate:
- The **current, still-open week** always uses the *live* `reward_rules.daily_star_goal`
  — a parent raising or lowering the goal today immediately changes what this
  week needs, rather than waiting until next Monday to take effect.
- **Completed (past) weeks** are frozen to whatever `reward_rule_history`
  records as in effect on that week's Monday, looked up via
  `getEffectiveDailyGoal()` in `chores/service.ts`. Changing the goal today
  never rewrites what a past week already showed.
- Rows in `reward_rule_history` are written by `setRewardRule()` only when
  the goal actually changes (not on every reward-text edit) or on the very
  first goal for a child. The `0005` migration backfills one row per
  existing `reward_rules` entry at `effective_from = '2000-01-01'`, since
  there's no record of what a goal was before this table existed — this
  preserves today's behavior for all pre-existing weeks; only goal changes
  from that migration forward are genuinely snapshotted.

## 4. Backend architecture

```
server/src/
  env.ts                    # port, data dir, session secret, RP_ID/RP_NAME (passkeys), origin
  version.ts                 # reads version.json once at startup, exposed at GET /api/version
  db/
    client.ts                # better-sqlite3 connection, WAL mode
    migrate.ts                # runs migrations/*.sql once, tracked in _migrations
    migrations/
      0001_init.sql
      0002_chore_tracker.sql
      0003_webauthn.sql
      0004_settings.sql
      0005_reward_rule_history.sql
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
    import.routes.ts                # parent-only: import a chore-export.json from a previous version
    settings.routes.ts              # parent-only: GET/PUT household timezone + history-weeks-shown
  settings/
    service.ts                      # getSettings()/updateSettings() over app_settings
  chores/
    service.ts                     # all business logic (below) — pure, no Express types
    routes.ts                       # thin Express layer over service.ts
    timezone.ts                     # Intl-based zoned day/week math (see §4.2) — no date library dependency
  app.ts                             # wires routers + static file serving
  index.ts                            # runs migrations, starts the HTTP server
```

### 4.1 Auth model

Two things make this different from a typical single-login app: only
Parents ever get a session, and Parents can authenticate with a password,
a passkey, or both.

- `GET /api/auth/profiles` → `{ needsSetup, profiles: [{id, name, avatarEmoji, role, hasPassword, hasPasskey}] }`,
  **filtered to `role = 'parent'`** — this is the list the management
  interface's login picker (and the Child Portal's embedded parent picker,
  see §5.3) renders. `needsSetup` is true iff `users` is empty (checked
  unfiltered — the very first user created is always a Parent, via
  `/setup`) — the client shows a "create the first Parent" form instead of
  a profile picker in that case.
- `POST /api/auth/setup` → creates the first Parent (only works while
  `needsSetup` is true; 409 otherwise).
- `POST /api/auth/login` with `{userId, password?}` → `userId` must resolve
  to a Parent (child IDs 404). If the profile has no `password_hash`,
  `password` is ignored and login succeeds outright; if it does, `password`
  must match. Rate-limited (`express-rate-limit`) to 10 attempts per 15
  minutes per IP.
- `POST /api/auth/login/passkey/options` with `{userId}` → generates a
  WebAuthn authentication challenge for that Parent (400 if they have no
  registered passkey). `POST /api/auth/login/passkey/verify` with
  `{userId, response}` → verifies the browser's assertion and, on success,
  creates a session exactly like the password path. Also rate-limited.
- `POST /api/auth/logout`, `GET /api/auth/session` → `{user: SessionUser | null}`.
- Session = a `nanoid(32)` token in an httpOnly cookie, looked up against the
  `sessions` table (30-day TTL) — an opaque, DB-backed token, not a signed
  JWT. `SESSION_SECRET` is unused for this reason; it's kept only as a
  placeholder should cookie signing ever be added. `requireAuth` populates
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
Put this app behind a reverse proxy with HTTPS (see §7) to get passkeys
working from every device, not just `localhost`.

### 4.2 Chore business logic (`chores/service.ts`)

This is the part worth reading closely — it's the one file with real logic,
everything else is CRUD plumbing. All day/week boundaries are computed in the
**household's configured timezone** (`app_settings.timezone`, an IANA name
like `America/New_York`, default `UTC`) via `chores/timezone.ts` — a small,
dependency-free module built on `Intl.DateTimeFormat`, not a date library.
Every calling function in `service.ts` reads the current timezone itself
(`householdTimezone()` / `getSettings()`) rather than taking it as a
parameter threaded in from routes — internal implementation detail, not part
of the public function signatures.

**Period keys** — what makes the "can't complete a chore twice in the same
period" rule work:

```ts
function computePeriodKey(frequency: Frequency, now: Date, timeZone: string): string {
  if (frequency === "daily") return zonedDateKey(now, timeZone);                        // '2026-07-09'
  if (frequency === "weekly") return zonedDateKey(zonedWeekStart(now, timeZone), timeZone); // that week's Monday
  return zonedMonthKey(now, timeZone);                                                   // '2026-07'
}
```

`toggleCompletion(choreId)` looks up `chore_completions` by
`(chore_id, period_key)` for *today's* computed key. If a row exists, delete
it (un-complete); if not, insert one. This makes "tap to complete" naturally
idempotent per period without any separate "already done" flag to keep in
sync.

**Week start = Monday**, always, in the household's timezone:
`zonedWeekStart()` resolves the correct local calendar date for `now`, walks
back to that week's Monday as pure Y-M-D arithmetic, then re-derives the
precise UTC instant of local midnight for *that* date — deliberately not
implemented as "subtract N × 86400000ms," which would drift by an hour if a
DST transition falls inside the week. A week always runs Monday 00:00 through
the following Monday 00:00 local time (exclusive) — i.e. it **ends on
Sunday**, which is what the weekly history feature (§1) depends on.

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
  threshold: number;         // live goal for the current week; historical snapshot for past weeks (see §3)
  rewardEarned: boolean;
  isCurrent: boolean;
  days: DayStars[];   // always 7 entries, Monday first
}

function computeWeeklyHistory(userId: string, timeZone: string, historyWeeksShown: number): WeekSummary[] {
  const now = new Date();
  const today = zonedDayStart(now, timeZone);
  const currentWeekStart = zonedWeekStart(now, timeZone);

  const weeks: WeekSummary[] = [];
  for (let i = 0; i <= historyWeeksShown; i++) {
    const weekStartDate = new Date(currentWeekStart.getTime() - i * 7 * 86400000);
    const weekStartKey = zonedDateKey(weekStartDate, timeZone);
    // The current, still-open week always reflects the live goal; only
    // completed weeks are frozen to the goal in effect when they started.
    const weeklyThreshold =
      i === 0 ? getRewardRule(userId).dailyStarGoal * 7 : getEffectiveDailyGoal(userId, weekStartKey) * 7;

    // ...days loop, sumStars() per day and for the whole week, as before...

    weeks.push({
      weekStart: weekStartKey,
      weekEnd: /* Sunday of this week */,
      stars: /* sumStars() for the week */,
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
eligibility, not historical reporting). `historyWeeksShown` comes from
`app_settings` (default 4), configurable via `/api/settings` — no longer a
hardcoded constant.

`getEffectiveDailyGoal(userId, asOfDateKey)` looks up `reward_rule_history`
for the most recent row with `effective_from <= asOfDateKey`; if none exists
(a week from before history tracking began), it falls back to the live
current goal — see the nuance in §3 for why the split between "current week"
and "past weeks" exists.

`computeProgress(userId)` (the "today / this week" tracker) also calls
`computeWeeklyHistory` and returns it as a `weeks` field — so every place
that already returns `Progress` (reward-rules endpoint, the toggle endpoint,
the portal endpoint) gets the weekly history for free, no separate
`/history` endpoint needed. Its top-level `weeklyThreshold`/`rewardEarned`
are derived from `weeks[0]` rather than recomputed separately, so the "This
week" progress bar always agrees with the current week's entry in the
history list below it.

### 4.3 API reference

All `/api/chores/*` and `/api/users/*` routes require a valid session
(`requireAuth` is applied once, at the router mount point, not per-route) —
and since only Parents ever get a session (§4.1), "parent" and "session" are
effectively the same precondition throughout this app. `/api/portal/*`
routes are deliberately public — the token in the URL *is* the credential.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/version` | none | `{year, month, build, label}` — baked in at Docker build time |
| GET | `/api/auth/profiles` | none | Parent profiles only |
| POST | `/api/auth/setup` | none, but 409 once `users` is non-empty | creates first Parent |
| POST | `/api/auth/login` | none, rate-limited | `{userId, password?}`, `userId` must be a Parent |
| POST | `/api/auth/login/passkey/options` | none | `{userId}` → WebAuthn authentication challenge |
| POST | `/api/auth/login/passkey/verify` | none, rate-limited | `{userId, response}` → creates session on success |
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
| POST | `/api/import` | parent | body is a `chore-export.json` payload — creates children, reward rules, portal links, chores, and completions as fresh copies |
| GET | `/api/settings` | parent | `{timezone, historyWeeksShown, availableTimezones}` |
| PUT | `/api/settings` | parent | `{timezone, historyWeeksShown}` — `timezone` must be a recognized IANA name |
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
  weeks: WeekSummary[]; // see §4.2 — weeks[0] is the current week
}
```

## 5. Frontend architecture

```
client/src/
  main.tsx                    # BrowserRouter + ThemeProvider + AuthProvider + <App/>
  App.tsx                      # routes: /login, /app, /app/users, /portal/:token
  index.css                     # Tailwind directives + .card/.input/.btn-* component classes
  api/
    client.ts                    # fetch wrapper (credentials: 'include'), typed api.get/post/put/delete
  context/
    AuthContext.tsx               # current user + refresh()/logout()
    useAuth.ts                     # the hook (split out for Fast Refresh)
    ThemeContext.tsx                # light/dark theme state, persisted to localStorage
    useTheme.ts                      # the hook (same Fast-Refresh reason as useAuth.ts)
  components/
    ProfileCard.tsx                # one tile in the profile picker
    AppBackground.tsx               # fixed gradient + glow-blob backdrop, shared across every screen
    ThemeToggle.tsx                  # fixed top-right light/dark switch
    VersionBadge.tsx                  # fixed bottom-right build label, reads GET /api/version
  pages/
    ProfilePicker.tsx               # Parent login screen — password and/or passkey. Reused, embedded,
                                      # as the Child Portal's "parental user picker" (see §5.3); an
                                      # optional `onCancel` prop renders a "← Back" link in that context.
    SetupWizard.tsx                  # first-run: create the first Parent
    Dashboard.tsx                     # the management interface — Parent-only, no role branch needed
    Users.tsx                          # the management interface's user admin: create/delete Parent +
                                         # Child profiles, set passwords, register/remove passkeys, import
                                         # a chore-export.json from a previous version, and household
                                         # settings (timezone, past-weeks-shown)
    ChildPortal.tsx                     # standalone, token-authenticated — NOT under AuthContext for
                                          # its data fetching, but mounts <ProfilePicker> as a takeover
                                          # overlay when "Parent sign-in" is tapped (see §5.3)
  chores/
    ChoreChecklist.tsx                 # presentational: a child's chores + progress. Used by
                                         # ChildPortal.tsx — the Portal always matches what a parent
                                         # sees for that child because they share this component.
    WeeklyHistory.tsx                   # presentational: day strip + previous-weeks list.
                                         # Used inside ChoreChecklist AND standalone in Dashboard.tsx
                                         # (behind a "Show history" toggle per child).
```

### 5.1 Component contracts

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

### 5.2 Auth flow

`ProfilePicker` fetches `/auth/profiles` (Parent-only, per §4.1). If
`needsSetup`, it renders `SetupWizard` instead. Otherwise it shows a grid of
`ProfileCard`s. What clicking one does depends on whether this is the
`/login` route or the Child Portal's embedded picker (`isPortalPicker =
!!onCancel`, since only the portal call site passes `onCancel`):

- **At `/login`**: clicking a profile with neither a password nor a passkey
  logs in immediately; clicking one with either reveals an inline panel — a
  "Use passkey" button (only if `hasPasskey` and the browser supports
  WebAuthn) and/or a password form (only if `hasPassword`).
- **In the portal's embedded picker**: only passkey sign-in is offered.
  There's no password form regardless of `hasPassword`, and no
  credential-less auto-login either — a profile with no passkey (or a
  passkey the current browser can't use) shows an explanatory message
  instead of a way to sign in. This is deliberate: the picker renders on a
  screen a child has physical, repeated access to, where a typed password
  can be watched or a credential-less profile just tapped straight into.

On success, `AuthContext.refresh()` is called and the router navigates to
`/app`.

`App.tsx`:

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

### 5.3 Child Portal flow

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

## 6. Styling system

Tailwind v3, class-based dark mode (`darkMode: "class"`, toggled via a `dark`
class on `<html>`), with one custom color scale (`brand`, a blue), two custom
animations (`blob`, `twinkle`), and component classes layered in `index.css`:

```js
// tailwind.config.js — theme.extend.colors.brand
{ 50: "#f2f6ff", 100: "#e3ecff", 200: "#c4d6ff", 300: "#9bb6ff", 400: "#6d8dff",
  500: "#4a66f5", 600: "#3548d6", 700: "#2b39ab", 800: "#252f86", 900: "#212a69" }
```

```css
/* index.css @layer components — each has a light base + dark: variant */
.card           /* glass panel: white card in light, translucent blurred panel in dark */
.input          /* bordered input, amber focus ring */
.btn-primary    /* amber gradient button — the app's one theme-agnostic accent color */
.btn-secondary  /* bordered button, light/dark background pair */
.btn-danger     /* small red-text button, used for delete actions */
```

Dark is the default theme (`ThemeContext`, persisted to `localStorage`); an
inline script in `index.html` applies the saved theme before first paint to
avoid a flash of the wrong theme. Gold/amber is used consistently as the
"stars" accent color across both themes — reward text, progress bars, and the
primary CTA all share it rather than using the blue `brand` scale, which is
reserved for selection/focus states.

## 7. Infra

**Ports & env vars** (see `server/src/env.ts`):

| Var | Default | Notes |
|---|---|---|
| `PORT` | `5152` | the port the server listens on |
| `DATA_DIR` | `./data` | where `chores.db` (+ WAL/SHM) lives |
| `SESSION_SECRET` | insecure dev default | not actually used for cookie signing today (sessions are opaque DB-backed tokens, not signed JWTs) — kept as a placeholder if that ever changes |
| `RP_ID` | `localhost` | WebAuthn Relying Party ID — must match the domain the app is served from for passkeys to work; see the secure-context caveat in §4.1 |
| `RP_NAME` | `Chorey` | display name shown by the OS passkey prompt during registration |
| `ORIGIN` | `http://localhost:5152` | used to build the Child Portal URL returned by `/api/chores/links`, and must match the origin WebAuthn ceremonies are verified against |

**Docker**: multi-stage build — build the Vite client, build the TS server,
copy both plus `node_modules` (prod only) and `version.json` into a
`node:20-alpine` runtime image. The container runs as the unprivileged
`node` user; an entrypoint script fixes ownership of the (often
root-owned, bind-mounted) `data/` directory before dropping privileges, so
this works on a fresh Linux host as well as locally. `data/` is a
bind-mounted volume so the SQLite file survives container restarts/rebuilds.

```yaml
# docker-compose.yml
services:
  chorey:
    build: .
    ports: ["5152:5152"]
    volumes:
      - ./data:/app/data
    environment:
      - SESSION_SECRET=${SESSION_SECRET:-change-me-in-production}
      - RP_ID=${RP_ID:-localhost}
      - ORIGIN=${ORIGIN:-http://localhost:5152}
    restart: unless-stopped
```

Passkeys need a real HTTPS origin (or `localhost`) to work at all — see the
secure-context caveat in §4.1. Put a reverse proxy (Caddy, Traefik, Nginx +
Let's Encrypt) in front of this for production if you want the Child
Portal's "Parent sign-in" passkey option to work from devices other than
`localhost`; set `RP_ID`/`ORIGIN` to match that domain.

`.github/workflows/docker-build.yml` builds and, on pushes to `main`, pushes
the image to GHCR — see the "Build versioning" section of
[CLAUDE.md](CLAUDE.md) for how that ties into `version.json`.

## 8. Known limitations and open questions

Genuine judgment calls and deliberate simplifications, not oversights —
worth knowing about before "fixing" any of them:

- **Timezone is household-level, not per-user**: `app_settings.timezone`
  applies to every child and parent alike. Fine for the app's actual usage
  model (one physical household), but a family split across timezones would
  need a `timezone` column on `users` instead — a bigger change, not
  attempted here since there's no evidence anyone needs it.
- **Re-importing via `/api/import` creates fresh copies, not a merge**: two
  imports of the same export produce duplicate children/chores rather than
  deduplicating by name. Intentional — a silent merge felt more surprising
  than a duplicate you can delete — but worth knowing before relying on it
  for repeated imports.

Resolved, previously listed here: historical reward thresholds now snapshot
correctly (`reward_rule_history`, §3), day/week boundaries respect a
configurable household timezone instead of hardcoded UTC (`chores/timezone.ts`),
the number of past weeks shown is a household setting instead of the
`PAST_WEEKS_SHOWN` constant, and the Child Portal's embedded parent picker
now offers passkey sign-in only — no password form, and no credential-less
auto-login — since `ProfilePicker` distinguishes `onCancel`-rendered (portal)
context from `/login` (see §5.2).

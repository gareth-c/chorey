import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getErrorMessage, type Profile } from "../api/client";
import { type ChoreItem, type ChoreProgress } from "../chores/ChoreChecklist";
import WeeklyHistory from "../chores/WeeklyHistory";

type Frequency = ChoreItem["frequency"];

interface AdminChore extends ChoreItem {
  assignedTo: string;
  assigneeName?: string;
  assigneeAvatar?: string;
}

interface RewardRule {
  userId: string;
  name: string;
  avatarEmoji: string;
  dailyStarGoal: number;
  weeklyReward: string;
  progress: ChoreProgress;
}

interface PortalLink {
  userId: string;
  name: string;
  avatarEmoji: string;
  url: string | null;
}

const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

// This is the management interface — only Parent profiles ever reach it
// (children sign in exclusively through their own Child Portal link, see
// pages/ChildPortal.tsx), so there's no role branch here.
export default function Dashboard() {
  const [chores, setChores] = useState<AdminChore[]>([]);
  const [children, setChildren] = useState<Profile[]>([]);
  const [rules, setRules] = useState<RewardRule[]>([]);
  const [links, setLinks] = useState<PortalLink[]>([]);
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, { goal: string; reward: string }>>(
    {}
  );
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});

  const [name, setName] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [stars, setStars] = useState("1");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [{ chores }, { users }, { rules }, { links }] = await Promise.all([
      api.get<{ chores: AdminChore[] }>("/chores"),
      api.get<{ users: Profile[] }>("/users"),
      api.get<{ rules: RewardRule[] }>("/chores/reward-rules"),
      api.get<{ links: PortalLink[] }>("/chores/links"),
    ]);
    setChores(chores);
    setChildren(users.filter((u) => u.role === "child"));
    setRules(rules);
    setLinks(links);
    setRuleDrafts(
      Object.fromEntries(
        rules.map((r) => [r.userId, { goal: String(r.dailyStarGoal), reward: r.weeklyReward }])
      )
    );
    if (!assignedTo && users.some((u) => u.role === "child")) {
      setAssignedTo(users.find((u) => u.role === "child")!.id);
    }
  }

  // `load` reads the current `assignedTo` to pick a default selection, so it can't be
  // memoized without going stale — intentionally fetch on mount only.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAddChore(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/chores", {
        name,
        assignedTo,
        frequency,
        stars: parseInt(stars, 10),
      });
      setName("");
      setStars("1");
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleDeleteChore(id: string) {
    if (!confirm("Delete this chore?")) return;
    await api.delete(`/chores/${id}`);
    await load();
  }

  async function handleSaveRule(userId: string) {
    const draft = ruleDrafts[userId];
    await api.put(`/chores/reward-rules/${userId}`, {
      dailyStarGoal: parseInt(draft.goal, 10) || 0,
      weeklyReward: draft.reward,
    });
    await load();
  }

  async function handleRegenerateLink(userId: string) {
    await api.post<{ url: string }>(`/chores/links/${userId}/regenerate`);
    await load();
  }

  async function handleCopy(url: string) {
    await navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 1500);
  }

  const header = (
    <div className="mb-1 flex items-start justify-between">
      <div>
        <h1 className="mb-1 text-2xl font-semibold text-slate-900">Chorey</h1>
        <p className="text-sm text-slate-500">Management interface</p>
      </div>
      <Link to="/app/users" className="btn-secondary">
        Manage users
      </Link>
    </div>
  );

  if (children.length === 0) {
    return (
      <div className="max-w-3xl">
        {header}

        <div className="relative mt-6 overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 px-8 py-14 shadow-2xl sm:px-14 sm:py-20">
          {/* Ambient glow blobs — purely decorative background texture */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -left-20 -top-20 h-72 w-72 animate-blob rounded-full bg-brand-500/30 blur-3xl" />
            <div
              className="absolute -bottom-24 right-0 h-80 w-80 animate-blob rounded-full bg-amber-400/20 blur-3xl"
              style={{ animationDelay: "4s" }}
            />
            <div
              className="absolute right-1/3 top-0 h-56 w-56 animate-blob rounded-full bg-fuchsia-500/10 blur-3xl"
              style={{ animationDelay: "8s" }}
            />
          </div>

          <div className="relative">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
              Getting started
            </p>
            <h1 className="max-w-xl text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
              Nobody's on the board yet.
            </h1>
            <p className="mt-4 max-w-lg text-base text-slate-300 sm:text-lg">
              Add your first Child profile and Chorey turns their chores into a star chart worth
              checking every day.
            </p>

            <Link
              to="/app/users"
              className="group mt-8 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 px-6 py-3 text-sm font-semibold text-slate-900 shadow-lg shadow-amber-500/30 transition-transform hover:scale-105 hover:shadow-amber-400/40"
            >
              <span className="text-lg transition-transform group-hover:rotate-90">＋</span>
              Add your first child
            </Link>

            {/* Ghost profile row — an intentional nod to a "who's watching"
                picker, foreshadowing where child avatars will appear. */}
            <div className="mt-12 flex items-center gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex h-14 w-14 animate-pulse items-center justify-center rounded-full border-2 border-dashed border-white/20 text-xl text-white/20 sm:h-16 sm:w-16"
                  style={{ animationDelay: `${i * 0.3}s` }}
                >
                  🙂
                </div>
              ))}
            </div>

            <div className="mt-10 flex flex-wrap gap-3">
              {[
                ["📋", "Assign chores"],
                ["⭐", "Track stars"],
                ["🎉", "Unlock rewards"],
              ].map(([emoji, label]) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm text-slate-200 backdrop-blur"
                >
                  <span aria-hidden="true" className="animate-twinkle">
                    {emoji}
                  </span>
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      {header}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-medium text-slate-900">Chores</h2>
        <div className="mb-5 space-y-2">
          {chores.map((chore) => (
            <div
              key={chore.id}
              className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span>{chore.assigneeAvatar}</span>
                <div>
                  <p className="text-sm font-medium text-slate-900">{chore.name}</p>
                  <p className="text-xs text-slate-400">
                    {chore.assigneeName} · {FREQUENCY_LABELS[chore.frequency]} · {chore.stars} ⭐
                  </p>
                </div>
              </div>
              <button className="btn-danger" onClick={() => handleDeleteChore(chore.id)}>
                Delete
              </button>
            </div>
          ))}
          {chores.length === 0 && <p className="text-sm text-slate-400">No chores yet.</p>}
        </div>

        <form onSubmit={handleAddChore} className="space-y-3">
          <input
            className="input"
            placeholder="Chore name (e.g. Make your bed)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <div className="flex gap-3">
            <select
              className="input"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
            >
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.avatarEmoji} {c.name}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
            >
              {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              max="100"
              className="input w-24"
              value={stars}
              onChange={(e) => setStars(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" className="btn-primary">
            Add chore
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-medium text-slate-900">Reward rules</h2>
        <div className="space-y-5">
          {rules.map((rule) => (
            <div key={rule.userId} className="rounded-xl border border-slate-100 p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-900">
                <span>{rule.avatarEmoji}</span> {rule.name}
                <span className="ml-auto text-xs font-normal text-slate-400">
                  {rule.progress.starsToday} ⭐ today · {rule.progress.starsThisWeek} ⭐ this week
                </span>
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  Daily star goal
                  <input
                    type="number"
                    min="0"
                    className="input w-20"
                    value={ruleDrafts[rule.userId]?.goal ?? "0"}
                    onChange={(e) =>
                      setRuleDrafts((d) => ({
                        ...d,
                        [rule.userId]: { ...d[rule.userId], goal: e.target.value },
                      }))
                    }
                  />
                </label>
                <input
                  className="input flex-1"
                  placeholder="Weekly reward (e.g. Movie night)"
                  value={ruleDrafts[rule.userId]?.reward ?? ""}
                  onChange={(e) =>
                    setRuleDrafts((d) => ({
                      ...d,
                      [rule.userId]: { ...d[rule.userId], reward: e.target.value },
                    }))
                  }
                />
                <button className="btn-secondary" onClick={() => handleSaveRule(rule.userId)}>
                  Save
                </button>
                <button
                  className="btn-secondary"
                  onClick={() =>
                    setExpandedHistory((e) => ({ ...e, [rule.userId]: !e[rule.userId] }))
                  }
                >
                  {expandedHistory[rule.userId] ? "Hide history" : "Show history"}
                </button>
              </div>
              {expandedHistory[rule.userId] && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <WeeklyHistory weeks={rule.progress.weeks} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-lg font-medium text-slate-900">Child Portal links</h2>
        <p className="mb-4 text-sm text-slate-500">
          Share this link with a child's iPad or phone — no login needed, and it only shows their
          own chores. A "Parent sign-in" link on that same page lets you switch into this
          management interface from the shared device, gated by your password or passkey.
          Regenerating a link replaces the old one (useful if a device is lost).
        </p>
        <div className="space-y-3">
          {links.map((link) => (
            <div
              key={link.userId}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 px-4 py-3"
            >
              <span>{link.avatarEmoji}</span>
              <span className="text-sm font-medium text-slate-900">{link.name}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-400">
                {link.url ?? "No link yet"}
              </span>
              {link.url && (
                <button className="btn-secondary" onClick={() => handleCopy(link.url!)}>
                  {copiedUrl === link.url ? "Copied!" : "Copy"}
                </button>
              )}
              <button className="btn-secondary" onClick={() => handleRegenerateLink(link.userId)}>
                {link.url ? "Regenerate" : "Generate"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

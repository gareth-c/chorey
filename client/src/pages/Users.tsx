import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/types";
import { api, getErrorMessage, type Profile } from "../api/client";
import { useAuth } from "../context/useAuth";

const EMOJIS = ["🏠", "🙂", "👩", "👨", "👧", "👦", "🐶", "🐱"];

interface ImportSummary {
  childrenImported: number;
  choresImported: number;
  completionsImported: number;
  choresSkipped: number;
}

interface AppSettings {
  timezone: string;
  historyWeeksShown: number;
  availableTimezones: string[];
}

export default function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [name, setName] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState(EMOJIS[0]);
  const [role, setRole] = useState<"parent" | "child">("child");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [passwordDraft, setPasswordDraft] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [timezoneDraft, setTimezoneDraft] = useState("");
  const [historyWeeksDraft, setHistoryWeeksDraft] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  async function load() {
    const { users } = await api.get<{ users: Profile[] }>("/users");
    setUsers(users);
  }

  async function loadSettings() {
    const data = await api.get<AppSettings>("/settings");
    setSettings(data);
    setTimezoneDraft(data.timezone);
    setHistoryWeeksDraft(String(data.historyWeeksShown));
  }

  useEffect(() => {
    void load();
    void loadSettings();
  }, []);

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSettingsError(null);
    setSettingsSaved(false);
    setSettingsSaving(true);
    try {
      await api.put("/settings", {
        timezone: timezoneDraft,
        historyWeeksShown: parseInt(historyWeeksDraft, 10) || 1,
      });
      await loadSettings();
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 1500);
    } catch (err) {
      setSettingsError(getErrorMessage(err));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/users", {
        name,
        avatarEmoji,
        role,
        password: role === "parent" && password ? password : undefined,
      });
      setName("");
      setPassword("");
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this profile? This cannot be undone.")) return;
    setManageError(null);
    try {
      await api.delete(`/users/${id}`);
      await load();
    } catch (err) {
      setManageError(getErrorMessage(err));
    }
  }

  async function handleSetPassword(id: string) {
    const value = passwordDraft[id];
    if (!value) return;
    setManageError(null);
    try {
      await api.post(`/users/${id}/password`, { password: value });
      setPasswordDraft((d) => ({ ...d, [id]: "" }));
      await load();
    } catch (err) {
      setManageError(getErrorMessage(err));
    }
  }

  async function handleRemovePassword(id: string) {
    setManageError(null);
    try {
      await api.delete(`/users/${id}/password`);
      await load();
    } catch (err) {
      setManageError(getErrorMessage(err));
    }
  }

  async function handleAddPasskey(id: string) {
    setManageError(null);
    try {
      const options = await api.post<PublicKeyCredentialCreationOptionsJSON>(
        `/users/${id}/passkey/register/options`
      );
      const response = await startRegistration(options);
      await api.post(`/users/${id}/passkey/register/verify`, { response });
      await load();
    } catch (err) {
      setManageError(getErrorMessage(err));
    }
  }

  async function handleRemovePasskey(id: string) {
    setManageError(null);
    try {
      await api.delete(`/users/${id}/passkey`);
      await load();
    } catch (err) {
      setManageError(getErrorMessage(err));
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-selected later
    if (!file) return;
    setImportError(null);
    setImportSummary(null);
    setImporting(true);
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error("That file isn't valid JSON.");
      }
      const { summary } = await api.post<{ summary: ImportSummary }>("/import", data);
      setImportSummary(summary);
      await load();
    } catch (err) {
      setImportError(getErrorMessage(err));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 sm:px-10 sm:py-14">
      <div className="mb-8 flex items-start justify-between border-b border-slate-200 pb-6 dark:border-white/10">
        <div>
          <h1 className="mb-1 text-2xl font-semibold text-slate-900 dark:text-white">Users</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Parents sign in to this management interface (password and/or passkey). Children have
            no login — they're reached only through their own Child Portal link.
          </p>
        </div>
        <Link to="/app" className="btn-secondary shrink-0">
          ← Back to chores
        </Link>
      </div>

      <div className="card mb-8 space-y-3">
        {manageError && (
          <p className="text-sm text-red-600 dark:text-red-400">{manageError}</p>
        )}
        {users.map((u) => (
          <div
            key={u.id}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0 dark:border-white/10"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-xl dark:bg-white/10">
                {u.avatarEmoji}
              </span>
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">{u.name}</p>
                <p className="text-xs capitalize text-slate-400">{u.role}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {u.role === "parent" ? (
                <>
                  <input
                    className="input w-32"
                    type="password"
                    placeholder="New password"
                    value={passwordDraft[u.id] ?? ""}
                    onChange={(e) => setPasswordDraft((d) => ({ ...d, [u.id]: e.target.value }))}
                  />
                  <button className="btn-secondary" onClick={() => handleSetPassword(u.id)}>
                    {u.hasPassword ? "Change" : "Set"} password
                  </button>
                  {u.hasPassword && (
                    <button className="btn-danger" onClick={() => handleRemovePassword(u.id)}>
                      Remove password
                    </button>
                  )}
                  <button className="btn-secondary" onClick={() => handleAddPasskey(u.id)}>
                    {u.hasPasskey ? "Add another passkey" : "Add passkey"}
                  </button>
                  {u.hasPasskey && (
                    <button className="btn-danger" onClick={() => handleRemovePasskey(u.id)}>
                      Remove passkeys
                    </button>
                  )}
                </>
              ) : (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Signs in via their Child Portal link
                </span>
              )}
              {u.id !== currentUser?.id && (
                <button className="btn-danger" onClick={() => handleDelete(u.id)}>
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="card mb-8">
        <h2 className="mb-1 text-lg font-medium text-slate-900 dark:text-white">
          Import from a previous version
        </h2>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Load a <code>chore-export.json</code> exported from an older Chore Tracker. This creates
          the children, their reward rules and Child Portal links, and re-adds every chore with its
          completion history. Importing again adds fresh copies rather than merging.
        </p>
        <label
          className={`btn-secondary inline-block cursor-pointer ${
            importing ? "cursor-not-allowed opacity-50" : ""
          }`}
        >
          {importing ? "Importing…" : "Choose export file…"}
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportFile}
            disabled={importing}
          />
        </label>
        {importError && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{importError}</p>
        )}
        {importSummary && (
          <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">
            Imported {importSummary.childrenImported} child profile
            {importSummary.childrenImported === 1 ? "" : "s"}, {importSummary.choresImported} chore
            {importSummary.choresImported === 1 ? "" : "s"}, and{" "}
            {importSummary.completionsImported} completion
            {importSummary.completionsImported === 1 ? "" : "s"}
            {importSummary.choresSkipped > 0
              ? ` · skipped ${importSummary.choresSkipped} chore${
                  importSummary.choresSkipped === 1 ? "" : "s"
                } with no matching child`
              : ""}
            .
          </p>
        )}
      </div>

      <div className="card mb-8">
        <h2 className="mb-1 text-lg font-medium text-slate-900 dark:text-white">
          Household settings
        </h2>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          The timezone controls when a day/week starts and ends for every chore and the star chart.
          The history length controls how many past weeks show up below the current one.
        </p>
        {settings && (
          <form onSubmit={handleSaveSettings} className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-sm text-slate-600 dark:text-slate-300">Timezone</span>
              <select
                className="input"
                value={timezoneDraft}
                onChange={(e) => setTimezoneDraft(e.target.value)}
              >
                {settings.availableTimezones.map((tz) => (
                  <option key={tz} value={tz} className="dark:bg-slate-900">
                    {tz}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-slate-600 dark:text-slate-300">
                Past weeks shown
              </span>
              <input
                type="number"
                min="1"
                max="52"
                className="input w-28"
                value={historyWeeksDraft}
                onChange={(e) => setHistoryWeeksDraft(e.target.value)}
              />
            </label>
            <button type="submit" disabled={settingsSaving} className="btn-secondary">
              {settingsSaving ? "Saving…" : settingsSaved ? "Saved!" : "Save"}
            </button>
          </form>
        )}
        {settingsError && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{settingsError}</p>
        )}
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-medium text-slate-900 dark:text-white">Add a profile</h2>
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="flex gap-3">
            <input
              className="input"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <select
              className="input w-36"
              value={role}
              onChange={(e) => setRole(e.target.value as "parent" | "child")}
            >
              <option value="parent" className="dark:bg-slate-900">
                Parent
              </option>
              <option value="child" className="dark:bg-slate-900">
                Child
              </option>
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            {EMOJIS.map((emoji) => (
              <button
                type="button"
                key={emoji}
                onClick={() => setAvatarEmoji(emoji)}
                className={`flex h-9 w-9 items-center justify-center rounded-full text-lg ${
                  avatarEmoji === emoji
                    ? "bg-amber-400/20 ring-2 ring-amber-500 dark:ring-amber-400"
                    : "bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10"
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>

          {role === "parent" && (
            <input
              type="password"
              className="input"
              placeholder="Password (optional — a passkey can be added afterward)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button type="submit" className="btn-primary">
            Add profile
          </button>
        </form>
      </div>
    </div>
  );
}

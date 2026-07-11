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

export default function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [name, setName] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState(EMOJIS[0]);
  const [role, setRole] = useState<"parent" | "child">("child");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [passwordDraft, setPasswordDraft] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);

  async function load() {
    const { users } = await api.get<{ users: Profile[] }>("/users");
    setUsers(users);
  }

  useEffect(() => {
    void load();
  }, []);

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
    await api.delete(`/users/${id}`);
    await load();
  }

  async function handleSetPassword(id: string) {
    const value = passwordDraft[id];
    if (!value) return;
    await api.post(`/users/${id}/password`, { password: value });
    setPasswordDraft((d) => ({ ...d, [id]: "" }));
    await load();
  }

  async function handleRemovePassword(id: string) {
    await api.delete(`/users/${id}/password`);
    await load();
  }

  async function handleAddPasskey(id: string) {
    try {
      const options = await api.post<PublicKeyCredentialCreationOptionsJSON>(
        `/users/${id}/passkey/register/options`
      );
      const response = await startRegistration(options);
      await api.post(`/users/${id}/passkey/register/verify`, { response });
      await load();
    } catch (err) {
      alert(getErrorMessage(err));
    }
  }

  async function handleRemovePasskey(id: string) {
    await api.delete(`/users/${id}/passkey`);
    await load();
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
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-semibold text-slate-900">Users</h1>
          <p className="text-sm text-slate-500">
            Parents sign in to this management interface (password and/or passkey). Children have
            no login — they're reached only through their own Child Portal link.
          </p>
        </div>
        <Link to="/app" className="btn-secondary">
          ← Back to chores
        </Link>
      </div>

      <div className="mb-8 space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {users.map((u) => (
          <div
            key={u.id}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-xl">
                {u.avatarEmoji}
              </span>
              <div>
                <p className="text-sm font-medium text-slate-900">{u.name}</p>
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
                <span className="text-xs text-slate-400">Signs in via their Child Portal link</span>
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

      <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-lg font-medium text-slate-900">Import from a previous version</h2>
        <p className="mb-4 text-sm text-slate-500">
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
        {importError && <p className="mt-3 text-sm text-red-600">{importError}</p>}
        {importSummary && (
          <p className="mt-3 text-sm text-green-700">
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

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-medium text-slate-900">Add a profile</h2>
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
              <option value="parent">Parent</option>
              <option value="child">Child</option>
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            {EMOJIS.map((emoji) => (
              <button
                type="button"
                key={emoji}
                onClick={() => setAvatarEmoji(emoji)}
                className={`flex h-9 w-9 items-center justify-center rounded-full text-lg ${
                  avatarEmoji === emoji ? "bg-brand-100 ring-2 ring-brand-500" : "bg-slate-100"
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

          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" className="btn-primary">
            Add profile
          </button>
        </form>
      </div>
    </div>
  );
}

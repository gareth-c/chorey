import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/types";
import { api, getErrorMessage, type Profile } from "../api/client";
import { useAuth } from "../context/useAuth";
import ProfileCard from "../components/ProfileCard";
import SetupWizard from "./SetupWizard";

/**
 * The Parent sign-in picker for the management interface. Also reused,
 * embedded, as the "parental user picker" a parent opens from the Child
 * Portal to switch into management mode on a shared device — pass
 * `onCancel` in that context so there's a way back to the child's checklist
 * without signing in.
 */
export default function ProfilePicker({ onCancel }: { onCancel?: () => void }) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh } = useAuth();
  const navigate = useNavigate();

  async function load() {
    const { profiles, needsSetup } = await api.get<{ profiles: Profile[]; needsSetup: boolean }>(
      "/auth/profiles"
    );
    setProfiles(profiles);
    setNeedsSetup(needsSetup);
  }

  useEffect(() => {
    void load();
  }, []);

  async function completeLogin() {
    await refresh();
    navigate("/app");
  }

  async function handleSelect(profile: Profile) {
    setError(null);
    if (!profile.hasPassword && !profile.hasPasskey) {
      setBusy(true);
      try {
        await api.post("/auth/login", { userId: profile.id });
        await completeLogin();
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    setSelected(profile);
    setPassword("");
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/login", { userId: selected.id, password });
      await completeLogin();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handlePasskeyLogin() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const options = await api.post<PublicKeyCredentialRequestOptionsJSON>(
        "/auth/login/passkey/options",
        { userId: selected.id }
      );
      const response = await startAuthentication(options);
      await api.post("/auth/login/passkey/verify", { userId: selected.id, response });
      await completeLogin();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (needsSetup) {
    return <SetupWizard onDone={completeLogin} />;
  }

  if (!profiles) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-400">Loading…</div>
    );
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-10 bg-slate-50">
      <div className="text-center">
        <h1 className="text-3xl font-semibold text-slate-900">Who's managing?</h1>
        <p className="mt-1 text-sm text-slate-500">Sign in to open the management interface.</p>
      </div>

      <div className="flex flex-wrap justify-center gap-6">
        {profiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            selected={selected?.id === profile.id}
            onClick={() => handleSelect(profile)}
          />
        ))}
      </div>

      {selected && (
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="mb-4 text-sm font-medium text-slate-700">Sign in as {selected.name}</p>

          {selected.hasPasskey && browserSupportsWebAuthn() && (
            <button
              onClick={handlePasskeyLogin}
              disabled={busy}
              className="btn-primary mb-3 w-full"
            >
              Use passkey
            </button>
          )}

          {selected.hasPassword && (
            <form onSubmit={handlePasswordSubmit} className="space-y-3">
              <input
                autoFocus
                type="password"
                className="input"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="submit" disabled={busy} className="btn-secondary w-full">
                Sign in with password
              </button>
            </form>
          )}

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>
      )}

      {onCancel && (
        <button onClick={onCancel} className="text-sm text-slate-400 hover:text-slate-600">
          ← Back to chores
        </button>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, getErrorMessage } from "../api/client";
import ChoreChecklist, { type ChoreItem, type ChoreProgress } from "../chores/ChoreChecklist";
import ProfilePicker from "./ProfilePicker";

interface PortalData {
  child: { name: string; avatarEmoji: string };
  chores: ChoreItem[];
  progress: ChoreProgress;
}

/**
 * The Child Portal: a no-login, per-child URL (the token is the credential —
 * see server/src/chores/service.ts's regenerateLink/resolveToken) meant to
 * live on a shared family tablet or a kid's own phone/browser bookmark.
 *
 * It also doubles as the on-device entry point into the management
 * interface: a "Parent sign-in" link reveals the same Parent picker used at
 * /login, so a parent doesn't need a separate URL to switch into management
 * mode on the shared device. Rendered here (with `onCancel` set), that
 * picker restricts sign-in to passkey only — no password form, since the
 * auth happens on a screen a child has physical access to (see
 * ProfilePicker.tsx).
 */
export default function ChildPortal() {
  const { token = "" } = useParams();
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showParentSignIn, setShowParentSignIn] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get<PortalData>(`/portal/${token}`);
      setData(data);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggle(choreId: string) {
    await api.post(`/portal/${token}/chores/${choreId}/toggle`);
    await load();
  }

  if (showParentSignIn) {
    return (
      <div className="fixed inset-0 z-50">
        <ProfilePicker onCancel={() => setShowParentSignIn(false)} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center p-6 text-center">
        <p className="text-slate-400">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-400">Loading…</div>
    );
  }

  return (
    <div className="min-h-screen p-6">
      <ChoreChecklist
        childName={data.child.name}
        avatarEmoji={data.child.avatarEmoji}
        chores={data.chores}
        progress={data.progress}
        onToggle={handleToggle}
      />
      <button
        onClick={() => setShowParentSignIn(true)}
        className="fixed bottom-4 right-4 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 shadow-sm hover:bg-slate-50 dark:border-white/15 dark:bg-white/10 dark:text-slate-300 dark:shadow-none dark:backdrop-blur dark:hover:bg-white/20"
      >
        Parent sign-in
      </button>
    </div>
  );
}

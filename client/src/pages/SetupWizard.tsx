import { useState } from "react";
import { api, getErrorMessage } from "../api/client";

const EMOJIS = ["🏠", "🙂", "👩", "👨", "👧", "👦", "🐶", "🐱"];

export default function SetupWizard({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState(EMOJIS[0]);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/auth/setup", {
        name,
        avatarEmoji,
        password: password || undefined,
      });
      onDone();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-slate-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <h1 className="text-2xl font-semibold text-slate-900">Welcome to Chorey</h1>
        <p className="mt-1 mb-6 text-sm text-slate-500">
          Let's set up the first Parent profile for your household.
        </p>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Your name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jamie"
            required
          />
        </label>

        <div className="mb-4">
          <span className="mb-1 block text-sm font-medium text-slate-700">Avatar</span>
          <div className="flex flex-wrap gap-2">
            {EMOJIS.map((emoji) => (
              <button
                type="button"
                key={emoji}
                onClick={() => setAvatarEmoji(emoji)}
                className={`flex h-10 w-10 items-center justify-center rounded-full text-xl ${
                  avatarEmoji === emoji ? "bg-brand-100 ring-2 ring-brand-500" : "bg-slate-100"
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        <label className="mb-6 block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Password <span className="font-normal text-slate-400">(optional)</span>
          </span>
          <input
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave blank for no password"
          />
        </label>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? "Creating…" : "Create household"}
        </button>
      </form>
    </div>
  );
}

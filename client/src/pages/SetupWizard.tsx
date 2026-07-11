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
    <div className="flex h-screen items-center justify-center px-6 py-10">
      <form onSubmit={handleSubmit} className="card w-full max-w-md">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
          Welcome to Chorey
        </h1>
        <p className="mt-1 mb-6 text-sm text-slate-500 dark:text-slate-400">
          Let's set up the first Parent profile for your household.
        </p>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">
            Your name
          </span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jamie"
            required
          />
        </label>

        <div className="mb-4">
          <span className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">
            Avatar
          </span>
          <div className="flex flex-wrap gap-2">
            {EMOJIS.map((emoji) => (
              <button
                type="button"
                key={emoji}
                onClick={() => setAvatarEmoji(emoji)}
                className={`flex h-10 w-10 items-center justify-center rounded-full text-xl ${
                  avatarEmoji === emoji
                    ? "bg-amber-400/20 ring-2 ring-amber-500 dark:ring-amber-400"
                    : "bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10"
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        <label className="mb-6 block">
          <span className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">
            Password{" "}
            <span className="font-normal text-slate-400 dark:text-slate-500">(optional)</span>
          </span>
          <input
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave blank for no password"
          />
        </label>

        {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? "Creating…" : "Create household"}
        </button>
      </form>
    </div>
  );
}

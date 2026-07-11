import WeeklyHistory, { type WeekSummary } from "./WeeklyHistory";

export interface ChoreItem {
  id: string;
  name: string;
  frequency: "daily" | "weekly" | "monthly";
  stars: number;
  doneThisPeriod: boolean;
}

export interface ChoreProgress {
  starsToday: number;
  dailyGoal: number;
  starsThisWeek: number;
  weeklyThreshold: number;
  weeklyReward: string;
  rewardEarned: boolean;
  weeks: WeekSummary[];
}

const FREQUENCY_LABELS: Record<ChoreItem["frequency"], string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

const FREQUENCY_ORDER: ChoreItem["frequency"][] = ["daily", "weekly", "monthly"];

export default function ChoreChecklist({
  childName,
  avatarEmoji,
  chores,
  progress,
  onToggle,
}: {
  childName: string;
  avatarEmoji: string;
  chores: ChoreItem[];
  progress: ChoreProgress;
  onToggle: (choreId: string) => void;
}) {
  const todayPct = progress.dailyGoal
    ? Math.min(100, Math.round((progress.starsToday / progress.dailyGoal) * 100))
    : 0;
  const weekPct = progress.weeklyThreshold
    ? Math.min(100, Math.round((progress.starsThisWeek / progress.weeklyThreshold) * 100))
    : 0;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-3xl dark:bg-white/10">
          {avatarEmoji}
        </span>
        <div>
          <p className="text-xl font-semibold text-slate-900 dark:text-white">
            {childName}'s chores
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">Tap a chore when it's done</p>
        </div>
      </div>

      <div className="card mb-6 space-y-4">
        <div>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">Today</span>
            <span className="text-amber-600 dark:text-amber-300">
              {progress.starsToday} {progress.dailyGoal > 0 && `/ ${progress.dailyGoal}`} ⭐
            </span>
          </div>
          {progress.dailyGoal > 0 && (
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all"
                style={{ width: `${todayPct}%` }}
              />
            </div>
          )}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">This week</span>
            <span className="text-amber-600 dark:text-amber-300">
              {progress.starsThisWeek}{" "}
              {progress.weeklyThreshold > 0 && `/ ${progress.weeklyThreshold}`} ⭐
            </span>
          </div>
          {progress.weeklyThreshold > 0 && (
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all"
                style={{ width: `${weekPct}%` }}
              />
            </div>
          )}
        </div>

        {progress.weeklyReward && (
          <div
            className={`rounded-xl px-4 py-3 text-sm font-medium ${
              progress.rewardEarned
                ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                : "border border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400"
            }`}
          >
            {progress.rewardEarned ? "🎉 Reward earned: " : "Reward this week: "}
            {progress.weeklyReward}
          </div>
        )}
      </div>

      <div className="mb-6">
        <WeeklyHistory weeks={progress.weeks} />
      </div>

      {FREQUENCY_ORDER.map((freq) => {
        const items = chores.filter((c) => c.frequency === freq);
        if (items.length === 0) return null;
        return (
          <div key={freq} className="mb-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {FREQUENCY_LABELS[freq]}
            </p>
            <div className="space-y-2">
              {items.map((chore) => (
                <button
                  key={chore.id}
                  onClick={() => onToggle(chore.id)}
                  className={`flex w-full items-center justify-between rounded-2xl border-2 px-5 py-4 text-left transition-colors ${
                    chore.doneThisPeriod
                      ? "border-emerald-200 bg-emerald-50 dark:border-emerald-400/30 dark:bg-emerald-500/10"
                      : "border-slate-200 bg-white hover:border-amber-300 dark:border-white/10 dark:bg-white/5 dark:hover:border-amber-400/40 dark:hover:bg-white/10"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-lg ${
                        chore.doneThisPeriod
                          ? "border-emerald-400 bg-emerald-400 text-white"
                          : "border-slate-300 text-transparent dark:border-white/20"
                      }`}
                    >
                      ✓
                    </span>
                    <span className="text-lg font-medium text-slate-900 dark:text-white">
                      {chore.name}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-amber-600 dark:text-amber-300">
                    {chore.stars} ⭐
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {chores.length === 0 && (
        <p className="text-center text-slate-500 dark:text-slate-400">No chores assigned yet.</p>
      )}
    </div>
  );
}

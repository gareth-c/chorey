export interface DayStars {
  date: string;
  stars: number;
  isToday: boolean;
  isFuture: boolean;
}

export interface WeekSummary {
  weekStart: string;
  weekEnd: string;
  stars: number;
  threshold: number;
  rewardEarned: boolean;
  isCurrent: boolean;
  days: DayStars[];
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export default function WeeklyHistory({ weeks }: { weeks: WeekSummary[] }) {
  const [currentWeek, ...pastWeeks] = weeks;
  if (!currentWeek) return null;

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium text-slate-200">This week so far</p>
        <div className="grid grid-cols-7 gap-1.5">
          {currentWeek.days.map((day, i) => (
            <div
              key={day.date}
              className={`rounded-xl border px-1.5 py-2 text-center ${
                day.isToday
                  ? "border-amber-400/40 bg-amber-400/10"
                  : day.isFuture
                    ? "border-white/5 bg-white/[0.02]"
                    : "border-white/10 bg-white/5"
              }`}
            >
              <p className="text-[10px] font-medium uppercase text-slate-500">
                {WEEKDAY_LABELS[i]}
              </p>
              <p
                className={`mt-0.5 text-sm font-semibold ${
                  day.isFuture ? "text-slate-600" : "text-white"
                }`}
              >
                {day.isFuture ? "–" : day.stars}
              </p>
            </div>
          ))}
        </div>
      </div>

      {pastWeeks.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-slate-200">Previous weeks</p>
          <div className="divide-y divide-white/10 rounded-xl border border-white/10 bg-white/5">
            {pastWeeks.map((week) => (
              <div
                key={week.weekStart}
                className="flex items-center justify-between px-4 py-2.5 text-sm"
              >
                <span className="text-slate-400">
                  {formatDate(week.weekStart)} – {formatDate(week.weekEnd)}
                </span>
                <span className="flex items-center gap-1.5 font-medium text-amber-300">
                  {week.rewardEarned && <span title="Reward earned">🎉</span>}
                  {week.stars}
                  {week.threshold > 0 && (
                    <span className="font-normal text-slate-500">/ {week.threshold}</span>
                  )}
                  <span className="font-normal">⭐</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

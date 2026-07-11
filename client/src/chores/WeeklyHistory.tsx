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
        <p className="mb-2 text-sm font-medium text-slate-700">This week so far</p>
        <div className="grid grid-cols-7 gap-1.5">
          {currentWeek.days.map((day, i) => (
            <div
              key={day.date}
              className={`rounded-xl border px-1.5 py-2 text-center ${
                day.isToday
                  ? "border-brand-300 bg-brand-50"
                  : day.isFuture
                    ? "border-slate-100 bg-slate-50"
                    : "border-slate-200 bg-white"
              }`}
            >
              <p className="text-[10px] font-medium uppercase text-slate-400">
                {WEEKDAY_LABELS[i]}
              </p>
              <p
                className={`mt-0.5 text-sm font-semibold ${
                  day.isFuture ? "text-slate-300" : "text-slate-900"
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
          <p className="mb-2 text-sm font-medium text-slate-700">Previous weeks</p>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {pastWeeks.map((week) => (
              <div
                key={week.weekStart}
                className="flex items-center justify-between px-4 py-2.5 text-sm"
              >
                <span className="text-slate-500">
                  {formatDate(week.weekStart)} – {formatDate(week.weekEnd)}
                </span>
                <span className="flex items-center gap-1.5 font-medium text-slate-900">
                  {week.rewardEarned && <span title="Reward earned">🎉</span>}
                  {week.stars}
                  {week.threshold > 0 && (
                    <span className="font-normal text-slate-400">/ {week.threshold}</span>
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

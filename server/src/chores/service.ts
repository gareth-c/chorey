import { nanoid } from "nanoid";
import { db } from "../db/client";
import { getSettings } from "../settings/service";
import {
  zonedAddDays,
  zonedDateKey,
  zonedDayStart,
  zonedMonthKey,
  zonedWeekStart,
  toSqliteDatetime,
} from "./timezone";

export type Frequency = "daily" | "weekly" | "monthly";
export type TimeOfDay = "all_day" | "morning" | "afternoon" | "evening";

interface ChoreRow {
  id: string;
  name: string;
  assigned_to: string;
  frequency: Frequency;
  stars: number;
  time_of_day: TimeOfDay;
  created_at: string;
  updated_at: string;
}

function householdTimezone(): string {
  return getSettings().timezone;
}

export function computePeriodKey(frequency: Frequency, now: Date, timeZone: string): string {
  if (frequency === "daily") return zonedDateKey(now, timeZone);
  if (frequency === "weekly") return zonedDateKey(zonedWeekStart(now, timeZone), timeZone);
  return zonedMonthKey(now, timeZone);
}

function sumStars(userId: string, start: string, end: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(c.stars), 0) as total
       FROM chore_completions cc
       JOIN chores c ON c.id = cc.chore_id
       WHERE cc.user_id = ? AND cc.completed_at >= ? AND cc.completed_at < ?`
    )
    .get(userId, start, end) as { total: number };
  return row.total;
}

/** The daily_star_goal in effect as of `asOfDateKey` ('YYYY-MM-DD'), per reward_rule_history. */
function getEffectiveDailyGoal(userId: string, asOfDateKey: string): number {
  const row = db
    .prepare(
      `SELECT daily_star_goal FROM reward_rule_history
       WHERE user_id = ? AND effective_from <= ?
       ORDER BY effective_from DESC, created_at DESC LIMIT 1`
    )
    .get(userId, asOfDateKey) as { daily_star_goal: number } | undefined;
  // No history row covers this date (e.g. reward rule never set) — fall back
  // to the live current value, same as the app's behavior before history was tracked.
  return row ? row.daily_star_goal : getRewardRule(userId).dailyStarGoal;
}

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

/** Current week (Mon-Sun) plus the last `historyWeeksShown` completed weeks, newest first. */
function computeWeeklyHistory(userId: string, timeZone: string, historyWeeksShown: number): WeekSummary[] {
  const now = new Date();
  const today = zonedDayStart(now, timeZone);
  const currentWeekStart = zonedWeekStart(now, timeZone);

  const weeks: WeekSummary[] = [];
  for (let i = 0; i <= historyWeeksShown; i++) {
    const weekStartDate = zonedAddDays(currentWeekStart, -i * 7, timeZone);
    const weekStartKey = zonedDateKey(weekStartDate, timeZone);
    // The current, still-open week always reflects the live goal — a parent
    // adjusting it today shouldn't feel ignored until next Monday. Only
    // completed weeks are frozen to the goal that was in effect when they started.
    const weeklyThreshold =
      i === 0 ? getRewardRule(userId).dailyStarGoal * 7 : getEffectiveDailyGoal(userId, weekStartKey) * 7;

    const days: DayStars[] = [];
    for (let d = 0; d < 7; d++) {
      const dayDate = zonedAddDays(weekStartDate, d, timeZone);
      const isFuture = dayDate > today;
      const stars = isFuture
        ? 0
        : sumStars(
            userId,
            toSqliteDatetime(dayDate),
            toSqliteDatetime(zonedAddDays(dayDate, 1, timeZone))
          );
      days.push({
        date: zonedDateKey(dayDate, timeZone),
        stars,
        isToday: zonedDateKey(dayDate, timeZone) === zonedDateKey(today, timeZone),
        isFuture,
      });
    }

    const weekEndDate = zonedAddDays(weekStartDate, 6, timeZone);
    const nextWeekStart = zonedAddDays(weekStartDate, 7, timeZone);
    const weekStars = sumStars(userId, toSqliteDatetime(weekStartDate), toSqliteDatetime(nextWeekStart));

    weeks.push({
      weekStart: weekStartKey,
      weekEnd: zonedDateKey(weekEndDate, timeZone),
      stars: weekStars,
      threshold: weeklyThreshold,
      rewardEarned: weeklyThreshold > 0 && weekStars >= weeklyThreshold,
      isCurrent: i === 0,
      days,
    });
  }
  return weeks;
}

export interface Progress {
  starsToday: number;
  dailyGoal: number;
  starsThisWeek: number;
  weeklyThreshold: number;
  weeklyReward: string;
  rewardEarned: boolean;
  weeks: WeekSummary[];
}

export function computeProgress(userId: string): Progress {
  const { timezone, historyWeeksShown } = getSettings();
  const now = new Date();
  const todayStart = zonedDayStart(now, timezone);
  const todayEnd = zonedAddDays(todayStart, 1, timezone);
  const weekStartDate = zonedWeekStart(now, timezone);
  const weekEndDate = zonedAddDays(weekStartDate, 7, timezone);

  const starsToday = sumStars(userId, toSqliteDatetime(todayStart), toSqliteDatetime(todayEnd));
  const starsThisWeek = sumStars(userId, toSqliteDatetime(weekStartDate), toSqliteDatetime(weekEndDate));

  const rule = getRewardRule(userId);
  const weeks = computeWeeklyHistory(userId, timezone, historyWeeksShown);
  // Derived from weeks[0] rather than recomputed, so "This week"'s progress bar
  // always agrees with the current week's entry in the history list below it.
  const weeklyThreshold = weeks[0].threshold;

  return {
    starsToday,
    dailyGoal: rule.dailyStarGoal,
    starsThisWeek,
    weeklyThreshold,
    weeklyReward: rule.weeklyReward,
    rewardEarned: weeklyThreshold > 0 && starsThisWeek >= weeklyThreshold,
    weeks,
  };
}

export interface ChoreWithStatus {
  id: string;
  name: string;
  assignedTo: string;
  assigneeName?: string;
  assigneeAvatar?: string;
  frequency: Frequency;
  timeOfDay: TimeOfDay;
  stars: number;
  doneThisPeriod: boolean;
}

function isDoneThisPeriod(chore: ChoreRow, now: Date, timeZone: string): boolean {
  const periodKey = computePeriodKey(chore.frequency, now, timeZone);
  return !!db
    .prepare("SELECT 1 FROM chore_completions WHERE chore_id = ? AND period_key = ?")
    .get(chore.id, periodKey);
}

export function listChoresForUser(userId: string): ChoreWithStatus[] {
  const rows = db
    .prepare("SELECT * FROM chores WHERE assigned_to = ? ORDER BY created_at ASC")
    .all(userId) as ChoreRow[];
  const now = new Date();
  const timeZone = householdTimezone();
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    assignedTo: c.assigned_to,
    frequency: c.frequency,
    timeOfDay: c.time_of_day,
    stars: c.stars,
    doneThisPeriod: isDoneThisPeriod(c, now, timeZone),
  }));
}

export function listAllChoresWithStatus(): ChoreWithStatus[] {
  const rows = db
    .prepare(
      `SELECT c.*, u.name as assignee_name, u.avatar_emoji as assignee_avatar
       FROM chores c
       JOIN users u ON u.id = c.assigned_to
       ORDER BY c.created_at ASC`
    )
    .all() as (ChoreRow & { assignee_name: string; assignee_avatar: string })[];
  const now = new Date();
  const timeZone = householdTimezone();
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    assignedTo: c.assigned_to,
    assigneeName: c.assignee_name,
    assigneeAvatar: c.assignee_avatar,
    frequency: c.frequency,
    timeOfDay: c.time_of_day,
    stars: c.stars,
    doneThisPeriod: isDoneThisPeriod(c, now, timeZone),
  }));
}

export function getChoreById(id: string) {
  return db.prepare("SELECT * FROM chores WHERE id = ?").get(id) as ChoreRow | undefined;
}

export function toggleCompletion(choreId: string): { completed: boolean } {
  const chore = getChoreById(choreId);
  if (!chore) throw new Error("Chore not found");

  const now = new Date();
  const periodKey = computePeriodKey(chore.frequency, now, householdTimezone());
  const existing = db
    .prepare("SELECT id FROM chore_completions WHERE chore_id = ? AND period_key = ?")
    .get(choreId, periodKey) as { id: string } | undefined;

  if (existing) {
    db.prepare("DELETE FROM chore_completions WHERE id = ?").run(existing.id);
    return { completed: false };
  }

  db.prepare(
    "INSERT INTO chore_completions (id, chore_id, user_id, period_key) VALUES (?, ?, ?, ?)"
  ).run(nanoid(), choreId, chore.assigned_to, periodKey);
  return { completed: true };
}

export function getRewardRule(userId: string): { dailyStarGoal: number; weeklyReward: string } {
  const row = db
    .prepare("SELECT daily_star_goal, weekly_reward FROM reward_rules WHERE user_id = ?")
    .get(userId) as { daily_star_goal: number; weekly_reward: string } | undefined;
  return { dailyStarGoal: row?.daily_star_goal ?? 0, weeklyReward: row?.weekly_reward ?? "" };
}

export function setRewardRule(userId: string, dailyStarGoal: number, weeklyReward: string) {
  const existing = getRewardRule(userId);
  const hasHistory = !!db
    .prepare("SELECT 1 FROM reward_rule_history WHERE user_id = ? LIMIT 1")
    .get(userId);

  db.prepare(
    `INSERT INTO reward_rules (user_id, daily_star_goal, weekly_reward) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       daily_star_goal = excluded.daily_star_goal,
       weekly_reward = excluded.weekly_reward,
       updated_at = datetime('now')`
  ).run(userId, dailyStarGoal, weeklyReward);

  // Only record a new history point when the goal actually changes (or this
  // is the first time it's set) — editing just the reward text shouldn't
  // create a new snapshot.
  if (!hasHistory || existing.dailyStarGoal !== dailyStarGoal) {
    db.prepare(
      "INSERT INTO reward_rule_history (id, user_id, daily_star_goal, effective_from) VALUES (?, ?, ?, ?)"
    ).run(nanoid(), userId, dailyStarGoal, zonedDateKey(new Date(), householdTimezone()));
  }
}

export function getLinkToken(userId: string): string | null {
  const row = db.prepare("SELECT token FROM portal_links WHERE user_id = ?").get(userId) as
    | { token: string }
    | undefined;
  return row?.token ?? null;
}

export function regenerateLink(userId: string): string {
  const token = nanoid(24);
  db.prepare(
    `INSERT INTO portal_links (user_id, token) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, created_at = datetime('now')`
  ).run(userId, token);
  return token;
}

export function resolveToken(
  token: string
): { userId: string; name: string; avatarEmoji: string } | null {
  const row = db
    .prepare(
      `SELECT ctl.user_id as user_id, u.name as name, u.avatar_emoji as avatar_emoji
       FROM portal_links ctl
       JOIN users u ON u.id = ctl.user_id
       WHERE ctl.token = ?`
    )
    .get(token) as { user_id: string; name: string; avatar_emoji: string } | undefined;
  if (!row) return null;
  return { userId: row.user_id, name: row.name, avatarEmoji: row.avatar_emoji };
}

import { nanoid } from "nanoid";
import { db } from "../db/client";

export type Frequency = "daily" | "weekly" | "monthly";

interface ChoreRow {
  id: string;
  name: string;
  assigned_to: string;
  frequency: Frequency;
  stars: number;
  created_at: string;
  updated_at: string;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function toDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function toMonthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

function startOfUTCDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function getWeekStart(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (day + 6) % 7;
  const start = startOfUTCDate(d);
  start.setUTCDate(start.getUTCDate() - diffToMonday);
  return start;
}

function formatSqliteDatetime(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(
    d.getUTCHours()
  )}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

export function computePeriodKey(frequency: Frequency, now: Date): string {
  if (frequency === "daily") return toDateKey(now);
  if (frequency === "weekly") return toDateKey(getWeekStart(now));
  return toMonthKey(now);
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

/** How many completed weeks (before the current, in-progress one) to include in the history. */
const PAST_WEEKS_SHOWN = 4;

/** Current week (Mon-Sun) plus the last PAST_WEEKS_SHOWN completed weeks, newest first. */
function computeWeeklyHistory(userId: string, weeklyThreshold: number): WeekSummary[] {
  const now = new Date();
  const today = startOfUTCDate(now);
  const currentWeekStart = getWeekStart(now);

  const weeks: WeekSummary[] = [];
  for (let i = 0; i <= PAST_WEEKS_SHOWN; i++) {
    const weekStartDate = new Date(currentWeekStart.getTime() - i * 7 * 86400000);
    const weekEndDate = new Date(weekStartDate.getTime() + 6 * 86400000);

    const days: DayStars[] = [];
    for (let d = 0; d < 7; d++) {
      const dayDate = new Date(weekStartDate.getTime() + d * 86400000);
      const isFuture = dayDate > today;
      const stars = isFuture
        ? 0
        : sumStars(
            userId,
            formatSqliteDatetime(dayDate),
            formatSqliteDatetime(new Date(dayDate.getTime() + 86400000))
          );
      days.push({
        date: toDateKey(dayDate),
        stars,
        isToday: toDateKey(dayDate) === toDateKey(today),
        isFuture,
      });
    }

    const weekStars = sumStars(
      userId,
      formatSqliteDatetime(weekStartDate),
      formatSqliteDatetime(new Date(weekStartDate.getTime() + 7 * 86400000))
    );

    weeks.push({
      weekStart: toDateKey(weekStartDate),
      weekEnd: toDateKey(weekEndDate),
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
  const now = new Date();
  const todayStart = formatSqliteDatetime(startOfUTCDate(now));
  const todayEnd = formatSqliteDatetime(new Date(startOfUTCDate(now).getTime() + 86400000));
  const weekStartDate = getWeekStart(now);
  const weekStart = formatSqliteDatetime(weekStartDate);
  const weekEnd = formatSqliteDatetime(new Date(weekStartDate.getTime() + 7 * 86400000));

  const starsToday = sumStars(userId, todayStart, todayEnd);
  const starsThisWeek = sumStars(userId, weekStart, weekEnd);

  const rule = getRewardRule(userId);
  const weeklyThreshold = rule.dailyStarGoal * 7;

  return {
    starsToday,
    dailyGoal: rule.dailyStarGoal,
    starsThisWeek,
    weeklyThreshold,
    weeklyReward: rule.weeklyReward,
    rewardEarned: rule.dailyStarGoal > 0 && starsThisWeek >= weeklyThreshold,
    weeks: computeWeeklyHistory(userId, weeklyThreshold),
  };
}

export interface ChoreWithStatus {
  id: string;
  name: string;
  assignedTo: string;
  assigneeName?: string;
  assigneeAvatar?: string;
  frequency: Frequency;
  stars: number;
  doneThisPeriod: boolean;
}

function isDoneThisPeriod(chore: ChoreRow, now: Date): boolean {
  const periodKey = computePeriodKey(chore.frequency, now);
  return !!db
    .prepare("SELECT 1 FROM chore_completions WHERE chore_id = ? AND period_key = ?")
    .get(chore.id, periodKey);
}

export function listChoresForUser(userId: string): ChoreWithStatus[] {
  const rows = db
    .prepare("SELECT * FROM chores WHERE assigned_to = ? ORDER BY created_at ASC")
    .all(userId) as ChoreRow[];
  const now = new Date();
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    assignedTo: c.assigned_to,
    frequency: c.frequency,
    stars: c.stars,
    doneThisPeriod: isDoneThisPeriod(c, now),
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
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    assignedTo: c.assigned_to,
    assigneeName: c.assignee_name,
    assigneeAvatar: c.assignee_avatar,
    frequency: c.frequency,
    stars: c.stars,
    doneThisPeriod: isDoneThisPeriod(c, now),
  }));
}

export function getChoreById(id: string) {
  return db.prepare("SELECT * FROM chores WHERE id = ?").get(id) as ChoreRow | undefined;
}

export function toggleCompletion(choreId: string): { completed: boolean } {
  const chore = getChoreById(choreId);
  if (!chore) throw new Error("Chore not found");

  const now = new Date();
  const periodKey = computePeriodKey(chore.frequency, now);
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
  db.prepare(
    `INSERT INTO reward_rules (user_id, daily_star_goal, weekly_reward) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       daily_star_goal = excluded.daily_star_goal,
       weekly_reward = excluded.weekly_reward,
       updated_at = datetime('now')`
  ).run(userId, dailyStarGoal, weeklyReward);
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

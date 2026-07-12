-- Tracks changes to daily_star_goal over time so a WeekSummary's threshold
-- can reflect whatever the goal was *when that week happened*, instead of
-- always applying today's goal retroactively.
CREATE TABLE IF NOT EXISTS reward_rule_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  daily_star_goal INTEGER NOT NULL,
  effective_from TEXT NOT NULL,          -- 'YYYY-MM-DD', the date this goal took effect
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reward_rule_history_user_effective
  ON reward_rule_history(user_id, effective_from);

-- Backfill: there's no record of what each child's goal was before this
-- migration, so treat the current value as having always been in effect —
-- this preserves today's behavior for all existing weeks, and only goal
-- changes from this point forward get correctly snapshotted.
INSERT INTO reward_rule_history (id, user_id, daily_star_goal, effective_from)
SELECT lower(hex(randomblob(16))), user_id, daily_star_goal, '2000-01-01'
FROM reward_rules;

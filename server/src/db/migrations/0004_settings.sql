-- Household-level settings. Singleton row (id is always 1) — this app has
-- exactly one household per install, so there's nothing to key it by.
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  history_weeks_shown INTEGER NOT NULL DEFAULT 4
);

INSERT OR IGNORE INTO app_settings (id, timezone, history_weeks_shown) VALUES (1, 'UTC', 4);

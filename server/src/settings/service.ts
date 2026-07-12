import { db } from "../db/client";

export interface AppSettings {
  timezone: string;
  historyWeeksShown: number;
}

interface SettingsRow {
  timezone: string;
  history_weeks_shown: number;
}

export function getSettings(): AppSettings {
  const row = db.prepare("SELECT timezone, history_weeks_shown FROM app_settings WHERE id = 1").get() as
    | SettingsRow
    | undefined;
  return {
    timezone: row?.timezone ?? "UTC",
    historyWeeksShown: row?.history_weeks_shown ?? 4,
  };
}

export function updateSettings(next: AppSettings) {
  db.prepare(
    `INSERT INTO app_settings (id, timezone, history_weeks_shown) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       timezone = excluded.timezone,
       history_weeks_shown = excluded.history_weeks_shown`
  ).run(next.timezone, next.historyWeeksShown);
}

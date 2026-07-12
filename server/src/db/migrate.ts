import fs from "node:fs";
import path from "node:path";
import { db } from "./client";

export function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const migrationsDir = path.join(__dirname, "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const appliedRows = db.prepare("SELECT name FROM _migrations").all() as { name: string }[];
  const applied = new Set(appliedRows.map((r) => r.name));

  // Each migration applies atomically — a multi-statement file that fails
  // halfway rolls back entirely instead of leaving a half-applied schema
  // that isn't recorded in _migrations.
  const applyMigration = db.transaction((name: string, sql: string) => {
    db.exec(sql);
    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(name);
  });

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    applyMigration(file, sql);
    console.log(`[migrate] applied ${file}`);
  }
}

import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { db } from "../db/client";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { regenerateLink, setRewardRule } from "../chores/service";
import { getErrorMessage } from "../utils/errors";

export const importRouter = Router();
importRouter.use(requireAuth);

// All stored datetimes are compared as strings against datetime('now')'s
// format — a malformed timestamp wouldn't error, it would just silently fall
// outside every sumStars() range and vanish from the charts. Reject it here.
const sqliteDatetime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, "must be 'YYYY-MM-DD HH:MM:SS'");

// Shape of a `chore-export.json` from an older Chore Tracker. We only read the
// source-of-truth fields (children, reward rules, chores, completions) — the
// derived `progress`/`weeks`/`days` in the export are ignored, since the app
// recomputes all of that from completion timestamps.
const importSchema = z.object({
  children: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100),
        avatarEmoji: z.string().min(1).max(10).optional().default("🙂"),
        rewardRule: z
          .object({
            dailyStarGoal: z.number().int().min(0).max(1000).optional().default(0),
            weeklyReward: z.string().max(500).optional().default(""),
          })
          .optional(),
      })
    )
    .default([]),
  chores: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        assignedTo: z.string(),
        frequency: z.enum(["daily", "weekly", "monthly"]),
        // Older exports predate time-of-day — default them to "all_day".
        timeOfDay: z.enum(["all_day", "morning", "afternoon", "evening"]).default("all_day"),
        stars: z.number().int().min(1).max(100),
        createdAt: sqliteDatetime.optional(),
        updatedAt: sqliteDatetime.optional(),
        completions: z
          .array(
            z.object({
              periodKey: z.string().min(1),
              completedAt: sqliteDatetime.optional(),
            })
          )
          .default([]),
      })
    )
    .default([]),
});

interface ImportSummary {
  childrenImported: number;
  choresImported: number;
  completionsImported: number;
  choresSkipped: number;
}

importRouter.post("/", requireRole("parent"), (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { children, chores } = parsed.data;

  const insertUser = db.prepare(
    "INSERT INTO users (id, name, avatar_emoji, role, password_hash) VALUES (?, ?, ?, 'child', NULL)"
  );
  const insertChore = db.prepare(
    `INSERT INTO chores (id, name, assigned_to, frequency, time_of_day, stars, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`
  );
  const insertCompletion = db.prepare(
    `INSERT INTO chore_completions (id, chore_id, user_id, period_key, completed_at)
     VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))`
  );

  const summary: ImportSummary = {
    childrenImported: 0,
    choresImported: 0,
    completionsImported: 0,
    choresSkipped: 0,
  };

  // Everything runs in one transaction — a failure anywhere rolls the whole
  // import back rather than leaving half a family imported.
  const runImport = db.transaction(() => {
    // Imported profiles always get fresh ids; map the export's old child id to
    // the new one so chores can be re-pointed at the right child.
    const childIdMap = new Map<string, string>();

    for (const child of children) {
      const newId = nanoid();
      insertUser.run(newId, child.name, child.avatarEmoji);
      childIdMap.set(child.id, newId);
      if (child.rewardRule) {
        setRewardRule(newId, child.rewardRule.dailyStarGoal, child.rewardRule.weeklyReward);
      }
      // Give each imported child a working Child Portal link out of the box.
      regenerateLink(newId);
      summary.childrenImported++;
    }

    for (const chore of chores) {
      const newChildId = childIdMap.get(chore.assignedTo);
      if (!newChildId) {
        // Chore points at a child that wasn't in this export — nothing to attach it to.
        summary.choresSkipped++;
        continue;
      }
      const newChoreId = nanoid();
      insertChore.run(
        newChoreId,
        chore.name,
        newChildId,
        chore.frequency,
        chore.timeOfDay,
        chore.stars,
        chore.createdAt ?? null,
        chore.updatedAt ?? null
      );
      summary.choresImported++;

      // The table enforces UNIQUE(chore_id, period_key); drop any dupes in the file.
      const seenPeriods = new Set<string>();
      for (const completion of chore.completions) {
        if (seenPeriods.has(completion.periodKey)) continue;
        seenPeriods.add(completion.periodKey);
        insertCompletion.run(
          nanoid(),
          newChoreId,
          newChildId,
          completion.periodKey,
          completion.completedAt ?? null
        );
        summary.completionsImported++;
      }
    }
  });

  try {
    runImport();
  } catch (err) {
    res.status(400).json({ error: getErrorMessage(err) });
    return;
  }

  res.json({ ok: true, summary });
});

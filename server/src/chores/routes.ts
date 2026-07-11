import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { db } from "../db/client";
import { requireRole } from "../middleware/requireRole";
import { env } from "../env";
import {
  computeProgress,
  getChoreById,
  getLinkToken,
  getRewardRule,
  listAllChoresWithStatus,
  listChoresForUser,
  regenerateLink,
  setRewardRule,
  toggleCompletion,
} from "./service";

interface UserRow {
  id: string;
  name: string;
  avatar_emoji: string;
  role: "parent" | "child";
}

function getChildren(): UserRow[] {
  return db
    .prepare(
      "SELECT id, name, avatar_emoji, role FROM users WHERE role = 'child' ORDER BY created_at ASC"
    )
    .all() as UserRow[];
}

function getUser(id: string): UserRow | undefined {
  return db.prepare("SELECT id, name, avatar_emoji, role FROM users WHERE id = ?").get(id) as
    | UserRow
    | undefined;
}

const choreSchema = z.object({
  name: z.string().min(1).max(200),
  assignedTo: z.string(),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  stars: z.number().int().min(1).max(100),
});

export function registerRoutes(router: Router) {
  router.get("/", (req, res) => {
    if (req.user!.role === "parent") {
      res.json({ chores: listAllChoresWithStatus() });
    } else {
      res.json({ chores: listChoresForUser(req.user!.id) });
    }
  });

  router.post("/", requireRole("parent"), (req, res) => {
    const parsed = choreSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { name, assignedTo, frequency, stars } = parsed.data;
    const child = getUser(assignedTo);
    if (!child || child.role !== "child") {
      res.status(400).json({ error: "assignedTo must be an existing Child profile" });
      return;
    }
    const id = nanoid();
    db.prepare(
      "INSERT INTO chores (id, name, assigned_to, frequency, stars) VALUES (?, ?, ?, ?, ?)"
    ).run(id, name, assignedTo, frequency, stars);
    res.status(201).json({ ok: true, id });
  });

  router.put("/:id", requireRole("parent"), (req, res) => {
    const existing = getChoreById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Chore not found" });
      return;
    }
    const parsed = choreSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { name, assignedTo, frequency, stars } = parsed.data;
    const child = getUser(assignedTo);
    if (!child || child.role !== "child") {
      res.status(400).json({ error: "assignedTo must be an existing Child profile" });
      return;
    }
    db.prepare(
      `UPDATE chores SET name = ?, assigned_to = ?, frequency = ?, stars = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(name, assignedTo, frequency, stars, existing.id);
    res.json({ ok: true });
  });

  router.delete("/:id", requireRole("parent"), (req, res) => {
    db.prepare("DELETE FROM chores WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  router.post("/:id/toggle", (req, res) => {
    const chore = getChoreById(req.params.id);
    if (!chore) {
      res.status(404).json({ error: "Chore not found" });
      return;
    }
    if (req.user!.role !== "parent" && req.user!.id !== chore.assigned_to) {
      res.status(403).json({ error: "You can only toggle your own chores" });
      return;
    }
    const result = toggleCompletion(req.params.id);
    res.json({ ...result, progress: computeProgress(chore.assigned_to) });
  });

  router.get("/reward-rules", (req, res) => {
    if (req.user!.role === "parent") {
      const rules = getChildren().map((child) => ({
        userId: child.id,
        name: child.name,
        avatarEmoji: child.avatar_emoji,
        ...getRewardRule(child.id),
        progress: computeProgress(child.id),
      }));
      res.json({ rules });
    } else {
      res.json({
        rules: [
          {
            userId: req.user!.id,
            name: req.user!.name,
            avatarEmoji: req.user!.avatar_emoji,
            ...getRewardRule(req.user!.id),
            progress: computeProgress(req.user!.id),
          },
        ],
      });
    }
  });

  const rewardRuleSchema = z.object({
    dailyStarGoal: z.number().int().min(0).max(1000),
    weeklyReward: z.string().max(500),
  });

  router.put("/reward-rules/:userId", requireRole("parent"), (req, res) => {
    const child = getUser(req.params.userId);
    if (!child || child.role !== "child") {
      res.status(400).json({ error: "Not a valid Child profile" });
      return;
    }
    const parsed = rewardRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    setRewardRule(child.id, parsed.data.dailyStarGoal, parsed.data.weeklyReward);
    res.json({ ok: true });
  });

  router.get("/links", requireRole("parent"), (_req, res) => {
    const links = getChildren().map((child) => {
      const token = getLinkToken(child.id);
      return {
        userId: child.id,
        name: child.name,
        avatarEmoji: child.avatar_emoji,
        url: token ? `${env.origin}/portal/${token}` : null,
      };
    });
    res.json({ links });
  });

  router.post("/links/:userId/regenerate", requireRole("parent"), (req, res) => {
    const child = getUser(req.params.userId);
    if (!child || child.role !== "child") {
      res.status(400).json({ error: "Not a valid Child profile" });
      return;
    }
    const token = regenerateLink(child.id);
    res.json({ url: `${env.origin}/portal/${token}` });
  });
}

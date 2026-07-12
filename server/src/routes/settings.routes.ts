import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { getSettings, updateSettings } from "../settings/service";
import { isValidTimezone, listTimezones } from "../chores/timezone";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get("/", requireRole("parent"), (_req, res) => {
  res.json({ ...getSettings(), availableTimezones: listTimezones() });
});

const updateSchema = z.object({
  timezone: z.string().refine(isValidTimezone, "Not a recognized IANA timezone"),
  historyWeeksShown: z.number().int().min(1).max(52),
});

settingsRouter.put("/", requireRole("parent"), (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  updateSettings(parsed.data);
  res.json({ ok: true });
});

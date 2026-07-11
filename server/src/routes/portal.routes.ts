import { Router } from "express";
import {
  computeProgress,
  getChoreById,
  listChoresForUser,
  resolveToken,
  toggleCompletion,
} from "../chores/service";

export const portalRouter = Router();

portalRouter.get("/:token", (req, res) => {
  const resolved = resolveToken(req.params.token);
  if (!resolved) {
    res.status(404).json({ error: "Unknown or revoked link" });
    return;
  }

  res.json({
    child: { name: resolved.name, avatarEmoji: resolved.avatarEmoji },
    chores: listChoresForUser(resolved.userId),
    progress: computeProgress(resolved.userId),
  });
});

portalRouter.post("/:token/chores/:choreId/toggle", (req, res) => {
  const resolved = resolveToken(req.params.token);
  if (!resolved) {
    res.status(404).json({ error: "Unknown or revoked link" });
    return;
  }

  const chore = getChoreById(req.params.choreId);
  if (!chore) {
    res.status(404).json({ error: "Chore not found" });
    return;
  }
  if (chore.assigned_to !== resolved.userId) {
    res.status(403).json({ error: "This chore isn't assigned to you" });
    return;
  }

  const result = toggleCompletion(req.params.choreId);
  res.json({ ...result, progress: computeProgress(resolved.userId) });
});

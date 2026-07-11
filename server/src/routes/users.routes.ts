import { Router, type Request } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { RegistrationResponseJSON } from "@simplewebauthn/types";
import { db } from "../db/client";
import { hashPassword } from "../auth/password";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { getRegistrationOptions, verifyRegistration } from "../auth/webauthn";
import { asyncHandler } from "../utils/asyncHandler";
import { getErrorMessage } from "../utils/errors";

export const usersRouter = Router();
usersRouter.use(requireAuth);

interface UserRow {
  id: string;
  name: string;
  avatar_emoji: string;
  role: "parent" | "child";
  password_hash: string | null;
}

function toPublicUser(u: UserRow) {
  const passkeyCount = (
    db.prepare("SELECT COUNT(*) as c FROM webauthn_credentials WHERE user_id = ?").get(u.id) as {
      c: number;
    }
  ).c;
  return {
    id: u.id,
    name: u.name,
    avatarEmoji: u.avatar_emoji,
    role: u.role,
    hasPassword: !!u.password_hash,
    hasPasskey: passkeyCount > 0,
  };
}

function getUser(id: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

usersRouter.get("/", requireRole("parent"), (_req, res) => {
  const users = db.prepare("SELECT * FROM users ORDER BY created_at ASC").all() as UserRow[];
  res.json({ users: users.map(toPublicUser) });
});

// Child profiles are chore-assignees only — they never sign in to the
// management interface, so they can't be given a password or passkey.
const createUserSchema = z
  .object({
    name: z.string().min(1).max(100),
    avatarEmoji: z.string().min(1).max(10).optional().default("🙂"),
    role: z.enum(["parent", "child"]),
    password: z.string().min(4).max(200).optional(),
  })
  .refine((data) => data.role === "parent" || !data.password, {
    message: "Child profiles can't have a password — they sign in via their Child Portal link",
    path: ["password"],
  });

usersRouter.post("/", requireRole("parent"), (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { name, avatarEmoji, role, password } = parsed.data;
  const id = nanoid();
  db.prepare(
    "INSERT INTO users (id, name, avatar_emoji, role, password_hash) VALUES (?, ?, ?, ?, ?)"
  ).run(id, name, avatarEmoji, role, password ? hashPassword(password) : null);
  const user = getUser(id)!;
  res.status(201).json({ user: toPublicUser(user) });
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatarEmoji: z.string().min(1).max(10).optional(),
  role: z.enum(["parent", "child"]).optional(),
});

usersRouter.put("/:id", requireRole("parent"), (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const existing = getUser(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const next = { ...existing, ...parsed.data };
  db.prepare("UPDATE users SET name = ?, avatar_emoji = ?, role = ? WHERE id = ?").run(
    next.name,
    next.avatar_emoji,
    next.role,
    existing.id
  );
  res.json({ user: toPublicUser(getUser(existing.id)!) });
});

usersRouter.delete("/:id", requireRole("parent"), (req, res) => {
  if (req.user!.id === req.params.id) {
    res.status(400).json({ error: "You cannot delete your own profile while logged in as it" });
    return;
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

function canManage(req: Request, targetId: string): boolean {
  return req.user!.role === "parent" || req.user!.id === targetId;
}

/** Password/passkey only ever apply to Parent profiles — see createUserSchema above. */
function requireParentTarget(req: Request, res: import("express").Response): UserRow | null {
  if (!canManage(req, req.params.id)) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  const user = getUser(req.params.id);
  if (!user || user.role !== "parent") {
    res.status(400).json({ error: "Not a valid Parent profile" });
    return null;
  }
  return user;
}

const setPasswordSchema = z.object({ password: z.string().min(4).max(200) });

usersRouter.post("/:id/password", (req, res) => {
  if (!requireParentTarget(req, res)) return;
  const parsed = setPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    hashPassword(parsed.data.password),
    req.params.id
  );
  res.json({ ok: true });
});

usersRouter.delete("/:id/password", (req, res) => {
  if (!requireParentTarget(req, res)) return;
  db.prepare("UPDATE users SET password_hash = NULL WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

usersRouter.post(
  "/:id/passkey/register/options",
  asyncHandler(async (req, res) => {
    const user = requireParentTarget(req, res);
    if (!user) return;
    try {
      const options = await getRegistrationOptions(user.id, user.name);
      res.json(options);
    } catch (err) {
      res.status(400).json({ error: getErrorMessage(err) });
    }
  })
);

usersRouter.post(
  "/:id/passkey/register/verify",
  asyncHandler(async (req, res) => {
    const user = requireParentTarget(req, res);
    if (!user) return;
    const { response } = req.body as { response: RegistrationResponseJSON };
    try {
      await verifyRegistration(user.id, response);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: getErrorMessage(err) });
    }
  })
);

usersRouter.delete("/:id/passkey", (req, res) => {
  if (!requireParentTarget(req, res)) return;
  db.prepare("DELETE FROM webauthn_credentials WHERE user_id = ?").run(req.params.id);
  res.json({ ok: true });
});

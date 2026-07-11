import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import rateLimit from "express-rate-limit";
import type { AuthenticationResponseJSON } from "@simplewebauthn/types";
import { db } from "../db/client";
import { hashPassword, verifyPassword } from "../auth/password";
import { createSession, destroySession, getSessionUser } from "../auth/session";
import { getAuthenticationOptions, verifyAuthentication } from "../auth/webauthn";
import { asyncHandler } from "../utils/asyncHandler";
import { getErrorMessage } from "../utils/errors";

export const authRouter = Router();

// Both are credential-verification endpoints (password / passkey signature),
// so both get throttled per source IP — otherwise either is brute-forceable
// with no cost to the attacker.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again in a few minutes." },
});

interface UserRow {
  id: string;
  name: string;
  avatar_emoji: string;
  role: "parent" | "child";
  password_hash: string | null;
}

function userCount(): number {
  return (db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
}

// Only Parent profiles ever sign in to the management interface — Child
// profiles have no password/passkey and are reached exclusively through
// their own Child Portal link (see routes/portal.routes.ts).
authRouter.get("/profiles", (_req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.name, u.avatar_emoji, u.role, u.password_hash,
              (SELECT COUNT(*) FROM webauthn_credentials w WHERE w.user_id = u.id) as passkey_count
       FROM users u WHERE u.role = 'parent' ORDER BY u.created_at ASC`
    )
    .all() as (UserRow & { passkey_count: number })[];

  res.json({
    needsSetup: userCount() === 0,
    profiles: users.map((u) => ({
      id: u.id,
      name: u.name,
      avatarEmoji: u.avatar_emoji,
      role: u.role,
      hasPassword: !!u.password_hash,
      hasPasskey: u.passkey_count > 0,
    })),
  });
});

authRouter.get("/session", (req, res) => {
  const user = getSessionUser(req);
  res.json({ user });
});

const setupSchema = z.object({
  name: z.string().min(1).max(100),
  avatarEmoji: z.string().min(1).max(10).optional().default("🏠"),
  password: z.string().min(8).max(200).optional(),
});

authRouter.post("/setup", (req, res) => {
  if (userCount() > 0) {
    res.status(409).json({ error: "Setup already completed" });
    return;
  }
  const parsed = setupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { name, avatarEmoji, password } = parsed.data;
  const id = nanoid();
  db.prepare(
    "INSERT INTO users (id, name, avatar_emoji, role, password_hash) VALUES (?, ?, ?, 'parent', ?)"
  ).run(id, name, avatarEmoji, password ? hashPassword(password) : null);

  createSession(res, id);
  res.json({ ok: true });
});

const loginSchema = z.object({
  userId: z.string(),
  password: z.string().optional(),
});

function getParentById(id: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ? AND role = 'parent'").get(id) as
    | UserRow
    | undefined;
}

authRouter.post("/login", loginLimiter, (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { userId, password } = parsed.data;
  const user = getParentById(userId);
  if (!user) {
    res.status(404).json({ error: "Unknown profile" });
    return;
  }

  if (user.password_hash) {
    if (!password || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: "Incorrect password" });
      return;
    }
  }

  createSession(res, user.id);
  res.json({ ok: true });
});

authRouter.post(
  "/login/passkey/options",
  asyncHandler(async (req, res) => {
    const { userId } = req.body as { userId?: string };
    if (!userId || !getParentById(userId)) {
      res.status(400).json({ error: "Unknown profile" });
      return;
    }
    try {
      const options = await getAuthenticationOptions(userId);
      res.json(options);
    } catch (err) {
      res.status(400).json({ error: getErrorMessage(err) });
    }
  })
);

authRouter.post(
  "/login/passkey/verify",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { userId, response } = req.body as {
      userId?: string;
      response?: AuthenticationResponseJSON;
    };
    if (!userId || !response || !getParentById(userId)) {
      res.status(400).json({ error: "userId and response required" });
      return;
    }
    try {
      await verifyAuthentication(userId, response);
      createSession(res, userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: getErrorMessage(err) });
    }
  })
);

authRouter.post("/logout", (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

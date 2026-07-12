import type { Request, Response } from "express";
import { nanoid } from "nanoid";
import { db } from "../db/client";
import { env } from "../env";

export const SESSION_COOKIE = "chore_tracker_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionUser {
  id: string;
  name: string;
  avatar_emoji: string;
  role: "parent" | "child";
}

function getCookie(req: Request, name: string): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[name];
}

export function createSession(res: Response, userId: string) {
  // Opportunistic housekeeping: expired rows are already invisible to
  // getSessionUser, but without this they'd accumulate forever.
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();

  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
    token,
    userId,
    expiresAt
  );
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.origin.startsWith("https"),
    maxAge: SESSION_TTL_MS,
  });
  return token;
}

export function destroySession(req: Request, res: Response) {
  const token = getCookie(req, SESSION_COOKIE);
  if (token) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  }
  res.clearCookie(SESSION_COOKIE);
}

export function getSessionUser(req: Request): SessionUser | null {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT u.id, u.name, u.avatar_emoji, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`
    )
    .get(token) as SessionUser | undefined;

  return row ?? null;
}

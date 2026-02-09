import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import argon2 from "argon2";
import { prisma } from "@mm/db";

const db = prisma as any;

const SESSION_COOKIE = "mm_session";
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? "30");

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function cookieOptions(maxAgeMs: number) {
  const secureEnv = (process.env.COOKIE_SECURE ?? "").toLowerCase();
  const secure =
    secureEnv === "1" ||
    secureEnv === "true" ||
    (secureEnv === "" && process.env.NODE_ENV === "production");
  const domain = process.env.COOKIE_DOMAIN?.trim();

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    maxAge: maxAgeMs,
    path: "/",
    ...(domain ? { domain } : {})
  };
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1
  });
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return argon2.verify(passwordHash, password);
}

export async function createSession(res: Response, userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();

  await db.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      lastActiveAt: now
    }
  });

  res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_DAYS * 24 * 60 * 60 * 1000));
}

export async function destroySession(res: Response, token?: string | null) {
  if (token) {
    await db.session.deleteMany({
      where: { tokenHash: hashToken(token) }
    });
  }

  const domain = process.env.COOKIE_DOMAIN?.trim();
  const opts = domain ? { path: "/", domain } : { path: "/" };
  res.clearCookie(SESSION_COOKIE, opts);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: "unauthorized" });

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true }
  });

  if (!session || session.expiresAt.getTime() < Date.now()) {
    await destroySession(res, token);
    return res.status(401).json({ error: "unauthorized" });
  }

  await db.session.update({
    where: { id: session.id },
    data: { lastActiveAt: new Date() }
  });

  res.locals.user = {
    id: session.user.id,
    email: session.user.email
  };
  next();
}

export function getUserFromLocals(res: Response): { id: string; email: string } {
  return res.locals.user as { id: string; email: string };
}

import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { prisma } from "@mm/db";
import { BitmartRestClient } from "@mm/exchange";
import { buildMmQuotes } from "@mm/strategy";
import { clamp } from "@mm/core";
import { z } from "zod";
import {
  createReauth,
  createSession,
  destroySession,
  getUserFromLocals,
  getRoleFromLocals,
  getWorkspaceId,
  hashPassword,
  isSuperadmin,
  requireAuth,
  requireReauth,
  verifyPassword
} from "./auth.js";
import { seedAdmin } from "./seed-admin.js";
import { ensureDefaultRoles } from "./rbac.js";
import { refreshCsrfCookie } from "./auth.js";
import { sendInviteEmail, sendReauthOtpEmail } from "./email.js";

const app = express();

const origins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
const REAUTH_OTP_TTL_MIN = Number(process.env.REAUTH_OTP_TTL_MIN ?? "10");

function isAllowedOrigin(origin?: string | null) {
  if (!origin) return false;
  return origins.includes(origin);
}

function hashOtp(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

async function getReauthOtpEnabled(): Promise<boolean> {
  const row = await prisma.globalSetting.findUnique({ where: { key: "security.reauth_otp_enabled" } });
  if (row?.value === undefined || row?.value === null) return true;
  return Boolean(row.value);
}

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, false);
    if (isAllowedOrigin(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

app.use((req, res, next) => {
  const origin = req.header("origin");
  if (!origin) {
    if (req.path === "/health" && ["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next();
    }
    return res.status(403).json({ error: "origin_required" });
  }
  return next();
});

const loginIpLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited" }
});

const loginUserLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = String((req.body as any)?.email ?? "").toLowerCase();
    return email ? `email:${email}` : `ip:${req.ip}`;
  },
  message: { error: "rate_limited" }
});

const reauthOtpLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited" }
});

app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  if (req.path === "/auth/login" || req.path === "/auth/register") {
    return next();
  }
  const origin = req.header("origin");
  if (!origin || !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: "origin_forbidden" });
  }
  const csrfCookie = req.cookies?.mm_csrf;
  const csrfHeader = req.header("x-csrf-token");
  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return res.status(403).json({ error: "csrf" });
  }
  return next();
});

const BotCreate = z.object({
  name: z.string(),
  symbol: z.string(),
  exchange: z.string()
});

const MMConfig = z.object({
  spreadPct: z.number(),
  maxSpreadPct: z.number(),
  levelsUp: z.number().int(),
  levelsDown: z.number().int(),
  budgetQuoteUsdt: z.number(),
  budgetBaseToken: z.number(),
  minOrderUsdt: z.number(),
  maxOrderUsdt: z.number(),
  distribution: z.enum(["LINEAR", "VALLEY", "RANDOM"]),
  jitterPct: z.number(),
  skewFactor: z.number(),
  maxSkew: z.number()
});

const VolConfig = z.object({
  dailyNotionalUsdt: z.number(),
  minTradeUsdt: z.number(),
  maxTradeUsdt: z.number(),
  activeFrom: z.string(),
  activeTo: z.string(),
  mode: z.enum(["PASSIVE", "MIXED", "ACTIVE"]),
  buyPct: z.number().min(0).max(1),
  buyBumpTicks: z.number().optional(),
  sellBumpTicks: z.number().optional()
});

const RiskConfig = z.object({
  minUsdt: z.number(),
  maxDeviationPct: z.number(),
  maxOpenOrders: z.number().int(),
  maxDailyLoss: z.number()
});

const NotificationConfig = z.object({
  fundsWarnEnabled: z.boolean(),
  fundsWarnPct: z.number().min(0).max(1)
});

const PriceSupportConfig = z.object({
  enabled: z.boolean(),
  floorPrice: z.number().nullable(),
  budgetUsdt: z.number(),
  maxOrderUsdt: z.number(),
  cooldownMs: z.number().int(),
  mode: z.enum(["PASSIVE", "MIXED"])
});

const CexConfig = z.object({
  exchange: z.string(),
  apiKey: z.string(),
  apiSecret: z.string(),
  apiMemo: z.string().optional()
});

function maskCex(cfg: any) {
  if (!cfg) return cfg;
  return {
    ...cfg,
    apiKey: cfg.apiKey ? `${cfg.apiKey.slice(0, 4)}...${cfg.apiKey.slice(-4)}` : "",
    apiSecret: cfg.apiSecret ? "********" : "",
    apiMemo: cfg.apiMemo ?? null
  };
}

const AlertConfig = z.object({
  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional()
});

const AuthPayload = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});
const ReauthPayload = z.object({
  password: z.string().min(6)
});
const PasswordChange = z.object({
  currentPassword: z.string().min(6),
  newPassword: z.string().min(6)
});
const SecuritySettings = z.object({
  autoLogoutEnabled: z.boolean(),
  autoLogoutMinutes: z.number().int().min(1).max(1440),
  reauthOtpEnabled: z.boolean().optional()
});

const ManualLimitOrder = z.object({
  side: z.enum(["BUY", "SELL", "buy", "sell"]),
  price: z.union([z.number(), z.string()]),
  quantity: z.union([z.number(), z.string()]),
  postOnly: z.boolean().optional(),
  timeInForce: z.enum(["GTC", "IOC"]).optional(),
  clientTag: z.string().optional()
});

const ManualMarketOrder = z.object({
  side: z.enum(["BUY", "SELL", "buy", "sell"]),
  quoteNotionalUsdt: z.union([z.number(), z.string()]).optional(),
  quantity: z.union([z.number(), z.string()]).optional()
});

const ManualCancelOrder = z.object({
  orderId: z.string().min(1)
});

async function createBotAlert(params: {
  botId: string;
  level: "info" | "warn" | "error";
  title: string;
  message?: string | null;
}) {
  await prisma.botAlert.create({
    data: {
      botId: params.botId,
      level: params.level,
      title: params.title,
      message: params.message ?? null
    }
  });
}

function parseNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  return NaN;
}

function roleAllows(res: express.Response, key: string): boolean {
  const role = getRoleFromLocals(res);
  const perms = role?.permissions ?? {};
  return Boolean(perms?.[key]);
}

async function getWorkspaceFeatures(workspaceId: string): Promise<Record<string, any>> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { features: true }
  });
  return (ws?.features as Record<string, any>) ?? {};
}

function requirePermission(key: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = getUserFromLocals(res);
    if (isSuperadmin(user)) return next();
    if (roleAllows(res, key)) return next();
    return res.status(403).json({ error: "forbidden" });
  };
}

function requireAnyPermission(keys: string[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = getUserFromLocals(res);
    if (isSuperadmin(user)) return next();
    const allowed = keys.some((k) => roleAllows(res, k));
    if (allowed) return next();
    return res.status(403).json({ error: "forbidden" });
  };
}

function requireWorkspaceAccess() {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = getUserFromLocals(res);
    const workspaceId = req.params.id;
    if (!workspaceId) return res.status(400).json({ error: "workspace_missing" });

    res.locals.workspaceId = workspaceId;
    if (isSuperadmin(user)) return next();

    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: user.id },
      include: { role: true }
    });
    if (!member) return res.status(403).json({ error: "forbidden" });
    res.locals.member = member;
    res.locals.role = member.role;
    next();
  };
}

async function writeAudit(params: {
  workspaceId: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  meta?: any;
  ip?: string | null;
}) {
  await prisma.auditEvent.create({
    data: {
      workspaceId: params.workspaceId,
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      meta: params.meta ?? undefined,
      ip: params.ip ?? undefined
    }
  });
}

async function sendTelegramAlert(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;

  return (await sendTelegramWithResult(token, chatId, text)).ok;
}

async function sendTelegramWithResult(token: string, chatId: string, text: string) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data?.ok === false) {
      const err = data?.description || data?.error || "telegram_error";
      return { ok: false, error: err, status: resp.status };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function sendTelegramWithFallback(text: string) {
  const envToken = process.env.TELEGRAM_BOT_TOKEN;
  const envChatId = process.env.TELEGRAM_CHAT_ID;
  if (envToken && envChatId) {
    return await sendTelegramWithResult(envToken, envChatId, text);
  }

  const cfg = await prisma.alertConfig.findUnique({ where: { key: "default" } });
  if (cfg?.telegramBotToken && cfg?.telegramChatId) {
    return await sendTelegramWithResult(cfg.telegramBotToken, cfg.telegramChatId, text);
  }

  return { ok: false, error: "telegram_not_configured" };
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/auth/register", async (req, res) => {
  const allowRegister = (process.env.ALLOW_REGISTER ?? "false").toLowerCase() === "true";
  if (!allowRegister) return res.status(403).json({ error: "registration_disabled" });

  const data = AuthPayload.parse(req.body);
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) return res.status(400).json({ error: "email_taken" });

  const passwordHash = await hashPassword(data.password);
  const user = await prisma.user.create({
    data: { email: data.email, passwordHash }
  });
  const workspace = await prisma.workspace.create({
    data: { name: "Default" }
  });
  const { adminRoleId } = await ensureDefaultRoles(workspace.id);
  await prisma.workspaceMember.create({
    data: { userId: user.id, workspaceId: workspace.id, roleId: adminRoleId }
  });

  await createSession(res, user.id);
  res.json({ ok: true });
});

app.post("/auth/login", loginIpLimiter, loginUserLimiter, async (req, res) => {
  const data = AuthPayload.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user) return res.status(401).json({ error: "invalid_credentials" });

  const ok = await verifyPassword(data.password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "invalid_credentials" });

  await createSession(res, user.id);
  res.json({ ok: true });
});

app.get("/auth/csrf", requireAuth, async (_req, res) => {
  refreshCsrfCookie(res);
  res.status(204).end();
});

app.post("/auth/reauth/request-otp", requireAuth, reauthOtpLimiter, async (_req, res) => {
  const user = getUserFromLocals(res);
  const otpEnabled = await getReauthOtpEnabled();
  if (!otpEnabled) return res.status(400).json({ error: "otp_disabled" });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + REAUTH_OTP_TTL_MIN * 60 * 1000);

  await prisma.reauthOtp.deleteMany({
    where: { userId: user.id, purpose: "REAUTH" }
  });

  await prisma.reauthOtp.create({
    data: {
      userId: user.id,
      purpose: "REAUTH",
      codeHash: hashOtp(code),
      expiresAt
    }
  });

  const emailResult = await sendReauthOtpEmail({
    to: user.email,
    code,
    expiresAt
  });

  if (!emailResult.ok) {
    await prisma.reauthOtp.deleteMany({
      where: { userId: user.id, purpose: "REAUTH" }
    });
    return res.status(400).json({ error: "email_failed", details: emailResult.error ?? null });
  }

  res.json({ ok: true, expiresAt });
});

app.post("/auth/reauth/verify-otp", requireAuth, reauthOtpLimiter, async (req, res) => {
  const user = getUserFromLocals(res);
  const otpEnabled = await getReauthOtpEnabled();
  if (!otpEnabled) return res.status(400).json({ error: "otp_disabled" });
  const payload = z.object({ code: z.string() }).parse(req.body);
  const code = payload.code.trim();
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "invalid_otp" });
  }

  const otp = await prisma.reauthOtp.findFirst({
    where: {
      userId: user.id,
      purpose: "REAUTH",
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: "desc" }
  });

  if (!otp) return res.status(401).json({ error: "otp_expired" });
  if (otp.codeHash !== hashOtp(code)) {
    return res.status(401).json({ error: "invalid_otp" });
  }

  await prisma.reauthOtp.deleteMany({
    where: { userId: user.id, purpose: "REAUTH" }
  });

  const session = await createReauth(res, user.id);
  res.json({ ok: true, expiresAt: session.expiresAt });
});

app.post("/auth/logout", requireAuth, async (req, res) => {
  const token = req.cookies?.mm_session ?? null;
  await destroySession(res, token);
  res.json({ ok: true });
});

app.get("/auth/me", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res) as any;
  const workspaceId = getWorkspaceId(res);
  const role = getRoleFromLocals(res);
  const features = await getWorkspaceFeatures(workspaceId);
  res.json({
    id: user.id,
    email: user.email,
    workspaceId,
    role: role?.name ?? "member",
    permissions: role?.permissions ?? {},
    isSuperadmin: isSuperadmin(user),
    features
  });
});

app.get("/me", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res) as any;
  const workspaceId = getWorkspaceId(res);
  const role = getRoleFromLocals(res);
  const features = await getWorkspaceFeatures(workspaceId);
  res.json({
    id: user.id,
    email: user.email,
    workspaceId,
    role: role?.name ?? "member",
    permissions: role?.permissions ?? {},
    isSuperadmin: isSuperadmin(user),
    features
  });
});

app.post("/auth/reauth", requireAuth, async (req, res) => {
  const data = ReauthPayload.parse(req.body);
  const user = getUserFromLocals(res);
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return res.status(401).json({ error: "unauthorized" });

  const ok = await verifyPassword(data.password, dbUser.passwordHash);
  if (!ok) return res.status(401).json({ error: "invalid_credentials" });

  const session = await createReauth(res, user.id);
  res.json({ ok: true, expiresAt: session.expiresAt });
});

app.post("/auth/change-password", requireAuth, async (req, res) => {
  const data = PasswordChange.parse(req.body);
  const user = getUserFromLocals(res);
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return res.status(401).json({ error: "unauthorized" });

  const ok = await verifyPassword(data.currentPassword, dbUser.passwordHash);
  if (!ok) return res.status(400).json({ error: "invalid_password" });

  const nextHash = await hashPassword(data.newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: nextHash }
  });

  res.json({ ok: true });
});

app.get("/workspaces/:id/members", requireAuth, requireWorkspaceAccess(), requirePermission("users.manage_members"), async (req, res) => {
  const workspaceId = req.params.id;
  await ensureDefaultRoles(workspaceId);
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    include: { user: true, role: true }
  });
  res.json(
    members.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      roleId: m.roleId,
      roleName: m.role?.name ?? "",
      status: m.status
    }))
  );
});

app.post("/workspaces/:id/members/invite", requireAuth, requireWorkspaceAccess(), requirePermission("users.manage_members"), requireReauth, async (req, res) => {
  const workspaceId = req.params.id;
  const actor = getUserFromLocals(res);
  const payload = z.object({
    email: z.string().email(),
    roleId: z.string(),
    resetPassword: z.boolean().optional()
  }).parse(req.body);

  const role = await prisma.role.findFirst({ where: { id: payload.roleId, workspaceId } });
  if (!role) return res.status(400).json({ error: "invalid_role" });

  let tempPassword: string | null = null;
  let user = await prisma.user.findUnique({ where: { email: payload.email } });
  if (!user) {
    tempPassword = crypto.randomBytes(8).toString("hex");
    const tempHash = await hashPassword(tempPassword);
    user = await prisma.user.create({
      data: { email: payload.email, passwordHash: tempHash }
    });
  } else if (payload.resetPassword) {
    tempPassword = crypto.randomBytes(8).toString("hex");
    const tempHash = await hashPassword(tempPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: tempHash }
    });
  }

  const exists = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: user.id }
  });
  if (exists) return res.status(400).json({ error: "member_exists" });

  const member = await prisma.workspaceMember.create({
    data: {
      workspaceId,
      userId: user.id,
      roleId: payload.roleId,
      status: "INVITED"
    }
  });

  await writeAudit({
    workspaceId,
    actorUserId: actor.id,
    action: "members.invite",
    entityType: "WorkspaceMember",
    entityId: member.id,
    meta: { email: payload.email, roleId: payload.roleId }
  });

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const baseUrl = process.env.INVITE_BASE_URL || "https://test.uliquid.vip";
  const emailResult = await sendInviteEmail({
    to: payload.email,
    workspaceName: workspace?.name ?? "Workspace",
    invitedByEmail: actor.email,
    tempPassword,
    baseUrl
  });

  res.json({ ok: true, memberId: member.id, emailSent: emailResult.ok, emailError: emailResult.error ?? null });
});

app.put("/workspaces/:id/members/:memberId", requireAuth, requireWorkspaceAccess(), requirePermission("users.manage_members"), requireReauth, async (req, res) => {
  const workspaceId = req.params.id;
  const actor = getUserFromLocals(res);
  const payload = z.object({ roleId: z.string().optional(), status: z.string().optional() }).parse(req.body);

  const member = await prisma.workspaceMember.findFirst({
    where: { id: req.params.memberId, workspaceId }
  });
  if (!member) return res.status(404).json({ error: "not_found" });

  if (payload.roleId) {
    const role = await prisma.role.findFirst({ where: { id: payload.roleId, workspaceId } });
    if (!role) return res.status(400).json({ error: "invalid_role" });
  }

  const updated = await prisma.workspaceMember.update({
    where: { id: member.id },
    data: {
      roleId: payload.roleId ?? member.roleId,
      status: payload.status ?? member.status
    }
  });

  await writeAudit({
    workspaceId,
    actorUserId: actor.id,
    action: "members.update",
    entityType: "WorkspaceMember",
    entityId: updated.id,
    meta: payload
  });

  res.json({ ok: true });
});

app.delete("/workspaces/:id/members/:memberId", requireAuth, requireWorkspaceAccess(), requirePermission("users.manage_members"), requireReauth, async (req, res) => {
  const workspaceId = req.params.id;
  const actor = getUserFromLocals(res);
  const member = await prisma.workspaceMember.findFirst({
    where: { id: req.params.memberId, workspaceId }
  });
  if (!member) return res.status(404).json({ error: "not_found" });

  await prisma.workspaceMember.delete({ where: { id: member.id } });
  await writeAudit({
    workspaceId,
    actorUserId: actor.id,
    action: "members.delete",
    entityType: "WorkspaceMember",
    entityId: member.id
  });
  res.json({ ok: true });
});

app.get("/workspaces/:id/roles", requireAuth, requireWorkspaceAccess(), requireAnyPermission(["users.manage_roles", "users.manage_members"]), async (req, res) => {
  const workspaceId = req.params.id;
  await ensureDefaultRoles(workspaceId);
  const roles = await prisma.role.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
  res.json(roles);
});

app.post("/workspaces/:id/roles", requireAuth, requireWorkspaceAccess(), requirePermission("users.manage_roles"), requireReauth, async (req, res) => {
  const workspaceId = req.params.id;
  const actor = getUserFromLocals(res);
  const payload = z.object({
    name: z.string().min(2),
    permissions: z.record(z.boolean()).optional()
  }).parse(req.body);

  const role = await prisma.role.create({
    data: {
      workspaceId,
      name: payload.name,
      permissions: payload.permissions ?? {}
    }
  });

  await writeAudit({
    workspaceId,
    actorUserId: actor.id,
    action: "roles.create",
    entityType: "Role",
    entityId: role.id
  });

  res.json(role);
});

app.put("/workspaces/:id/roles/:roleId", requireAuth, requireWorkspaceAccess(), requirePermission("users.manage_roles"), requireReauth, async (req, res) => {
  const workspaceId = req.params.id;
  const actor = getUserFromLocals(res);
  const payload = z.object({
    name: z.string().min(2).optional(),
    permissions: z.record(z.boolean()).optional()
  }).parse(req.body);

  const role = await prisma.role.findFirst({ where: { id: req.params.roleId, workspaceId } });
  if (!role) return res.status(404).json({ error: "not_found" });
  if (role.isSystem && payload.name && payload.name !== role.name) {
    return res.status(400).json({ error: "system_role_rename_forbidden" });
  }

  const updated = await prisma.role.update({
    where: { id: role.id },
    data: {
      name: payload.name ?? role.name,
      permissions: payload.permissions ?? role.permissions
    }
  });

  await writeAudit({
    workspaceId,
    actorUserId: actor.id,
    action: "roles.update",
    entityType: "Role",
    entityId: updated.id
  });

  res.json(updated);
});

app.delete("/workspaces/:id/roles/:roleId", requireAuth, requireWorkspaceAccess(), requirePermission("users.manage_roles"), requireReauth, async (req, res) => {
  const workspaceId = req.params.id;
  const actor = getUserFromLocals(res);
  const role = await prisma.role.findFirst({ where: { id: req.params.roleId, workspaceId } });
  if (!role) return res.status(404).json({ error: "not_found" });
  if (role.isSystem && !isSuperadmin(actor)) {
    return res.status(400).json({ error: "system_role_delete_forbidden" });
  }

  const assigned = await prisma.workspaceMember.count({ where: { workspaceId, roleId: role.id } });
  if (assigned > 0) return res.status(400).json({ error: "role_in_use" });

  await prisma.role.delete({ where: { id: role.id } });
  await writeAudit({
    workspaceId,
    actorUserId: actor.id,
    action: "roles.delete",
    entityType: "Role",
    entityId: role.id
  });

  res.json({ ok: true });
});

app.get("/workspaces/:id/audit", requireAuth, requireWorkspaceAccess(), requirePermission("audit.view"), async (req, res) => {
  const workspaceId = req.params.id;
  const limit = Math.min(Number(req.query.limit || "50"), 200);
  const items = await prisma.auditEvent.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: limit
  });
  res.json(items);
});

app.get("/global-settings", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  if (!isSuperadmin(user)) return res.status(403).json({ error: "forbidden" });
  const settings = await prisma.globalSetting.findMany({ orderBy: { key: "asc" } });
  res.json(settings);
});

app.put("/global-settings/:key", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  if (!isSuperadmin(user)) return res.status(403).json({ error: "forbidden" });
  const payload = z.object({ value: z.any() }).parse(req.body);
  const setting = await prisma.globalSetting.upsert({
    where: { key: req.params.key },
    update: { value: payload.value },
    create: { key: req.params.key, value: payload.value }
  });
  res.json(setting);
});


app.get("/auth/reauth/status", requireAuth, async (req, res) => {
  const token = req.cookies?.mm_reauth;
  if (!token) return res.json({ ok: false });

  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const session = await prisma.reauthSession.findUnique({ where: { tokenHash: hash } });
  if (!session || session.expiresAt.getTime() < Date.now()) {
    res.clearCookie("mm_reauth", { path: "/" });
    return res.json({ ok: false });
  }
  res.json({ ok: true, expiresAt: session.expiresAt });
});

app.post("/alerts/test", requireAuth, async (_req, res) => {
  const text = `Test alert ✅ ${new Date().toLocaleString()}`;
  const result = await sendTelegramWithFallback(text);

  if (!result || !result.ok) {
    return res.status(400).json({
      error: "telegram_not_configured_or_unreachable",
      details: result?.error ?? "unknown"
    });
  }

  res.json({ ok: true });
});

app.get("/bots", requireAuth, requirePermission("bots.view"), async (_req, res) => {
  const workspaceId = getWorkspaceId(res);
  const features = await getWorkspaceFeatures(workspaceId);
  const priceSupportFeature = Boolean(features?.priceSupport);
  const bots = await prisma.bot.findMany({
    where: { workspaceId },
    include: { priceSupportConfig: true },
    orderBy: { createdAt: "desc" }
  });
  const mapped = bots.map((b) => {
    const ps = priceSupportFeature ? b.priceSupportConfig : null;
    const remaining = ps ? Math.max(0, ps.budgetUsdt - ps.spentUsdt) : null;
    const status = !ps?.enabled ? "OFF" : ps.active ? "ON" : "STOPPED";
    return {
      ...b,
      priceSupportConfig: ps,
      priceSupportEnabled: Boolean(ps?.enabled),
      priceSupportActive: Boolean(ps?.active),
      priceSupportFloorPrice: ps?.floorPrice ?? null,
      priceSupportRemainingUsdt: remaining,
      priceSupportStatus: status
    };
  });
  res.json(mapped);
});

app.get("/bots/:id", requireAuth, requirePermission("bots.view"), async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const user = getUserFromLocals(res);
  const features = await getWorkspaceFeatures(workspaceId);
  const priceSupportFeature = Boolean(features?.priceSupport);
  const bot = await prisma.bot.findFirst({
    where: { id: req.params.id, workspaceId },
    include: {
      mmConfig: true,
      volConfig: true,
      riskConfig: true,
      notificationConfig: true,
      priceSupportConfig: true,
      runtime: true
    } as any
  });
  if (!bot) return res.status(404).json({ error: "not_found" });
  if (!isSuperadmin(user) && bot.volConfig) {
    bot.volConfig.buyBumpTicks = undefined as any;
    bot.volConfig.sellBumpTicks = undefined as any;
  }
  if (!priceSupportFeature) {
    bot.priceSupportConfig = null as any;
  }
  res.json(bot);
});

app.get("/bots/:id/runtime", requireAuth, requirePermission("bots.view"), async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const bot = await prisma.bot.findFirst({ where: { id: req.params.id, workspaceId } });
  if (!bot) return res.status(404).json({ error: "not_found" });
  const rt = await prisma.botRuntime.findUnique({ where: { botId: req.params.id } });
  res.json(rt ?? null);
});

app.delete("/bots/:id", requireAuth, requirePermission("bots.delete"), async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const user = getUserFromLocals(res);
  const botId = req.params.id;
  const bot = await prisma.bot.findFirst({ where: { id: botId, workspaceId } });
  if (!bot) return res.status(404).json({ error: "not_found" });

  await prisma.$transaction([
    prisma.botAlert.deleteMany({ where: { botId } }),
    prisma.botRuntime.deleteMany({ where: { botId } }),
    prisma.marketMakingConfig.deleteMany({ where: { botId } }),
    prisma.volumeConfig.deleteMany({ where: { botId } }),
    prisma.riskConfig.deleteMany({ where: { botId } }),
    prisma.botNotificationConfig.deleteMany({ where: { botId } }),
    prisma.botPriceSupportConfig.deleteMany({ where: { botId } }),
    prisma.manualTradeLog.deleteMany({ where: { botId } }),
    prisma.bot.delete({ where: { id: botId } })
  ]);

  await writeAudit({
    workspaceId,
    actorUserId: user.id,
    action: "bots.delete",
    entityType: "Bot",
    entityId: botId,
    meta: { name: bot.name, symbol: bot.symbol }
  });

  res.json({ ok: true });
});

app.get("/bots/:id/open-orders", requireAuth, requirePermission("bots.view"), async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const bot = await prisma.bot.findFirst({ where: { id: req.params.id, workspaceId } });
  if (!bot) return res.status(404).json({ error: "not_found" });
  if (bot.exchange.toLowerCase() !== "bitmart") {
    return res.status(400).json({ error: "unsupported_exchange" });
  }

  const cex = await prisma.cexConfig.findUnique({ where: { exchange: bot.exchange } });
  if (!cex?.apiKey || !cex?.apiSecret) {
    return res.status(400).json({ error: "cex_config_missing" });
  }

  const baseUrl = process.env.BITMART_BASE_URL || "https://api-cloud.bitmart.com";
  const rest = new BitmartRestClient(baseUrl, cex.apiKey, cex.apiSecret, cex.apiMemo ?? "");
  const orders = await rest.getOpenOrders(bot.symbol);

  const normalized = orders.map((o) => ({
    id: o.id,
    side: o.side,
    price: o.price,
    qty: o.qty,
    clientOrderId: o.clientOrderId ?? null,
    createdAt: null
  }));

  const isMm = (cid?: string | null) => {
    const c = cid ?? "";
    return c.startsWith("mm-") || c.startsWith("mmb") || c.startsWith("mms");
  };
  const isVol = (cid?: string | null) => {
    const c = cid ?? "";
    return c.startsWith("vol-") || c.startsWith("vol");
  };

  res.json({
    mm: normalized.filter((o) => isMm(o.clientOrderId)),
    vol: normalized.filter((o) => isVol(o.clientOrderId)),
    other: normalized.filter((o) => !isMm(o.clientOrderId) && !isVol(o.clientOrderId))
  });
});

app.post("/bots/:id/manual/limit", requireAuth, requirePermission("trading.manual_limit"), requireReauth, async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const user = getUserFromLocals(res);
  const bot = await prisma.bot.findFirst({ where: { id: req.params.id, workspaceId } });
  if (!bot) return res.status(404).json({ error: "not_found" });
  if (bot.exchange.toLowerCase() !== "bitmart") {
    return res.status(400).json({ error: "unsupported_exchange" });
  }

  const data = ManualLimitOrder.parse(req.body);
  const side = data.side.toLowerCase() as "buy" | "sell";
  const price = parseNumber(data.price);
  const qty = parseNumber(data.quantity);
  const postOnly = data.postOnly ?? true;

  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ error: "invalid_order" });
  }

  const cex = await prisma.cexConfig.findUnique({ where: { exchange: bot.exchange } });
  if (!cex?.apiKey || !cex?.apiSecret) {
    return res.status(400).json({ error: "cex_config_missing" });
  }

  const tag = data.clientTag ? `_${data.clientTag.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12)}` : "";
  const clientOrderId = `man_${bot.id}_${Date.now().toString(36)}${tag}`;
  const baseUrl = process.env.BITMART_BASE_URL || "https://api-cloud.bitmart.com";
  const rest = new BitmartRestClient(baseUrl, cex.apiKey, cex.apiSecret, cex.apiMemo ?? "");

  try {
    const order = await rest.placeOrder({
      symbol: bot.symbol,
      side,
      type: "limit",
      price,
      qty,
      postOnly,
      clientOrderId
    });

    await prisma.manualTradeLog.create({
      data: {
        workspaceId,
        userId: user.id,
        botId: bot.id,
        symbol: bot.symbol,
        type: "LIMIT",
        side: side.toUpperCase(),
        qty,
        price,
        notional: price * qty,
        postOnly,
        timeInForce: data.timeInForce ?? "GTC",
        clientOrderId,
        exchangeOrderId: order.id,
        status: "SUBMITTED"
      }
    });

    await writeAudit({
      workspaceId,
      actorUserId: user.id,
      action: "manual.limit.submit",
      entityType: "Bot",
      entityId: bot.id,
      meta: { side, price, qty, clientOrderId }
    });

    res.json({ exchangeOrderId: order.id, clientOrderId, status: order.status });
  } catch (e: any) {
    const errMsg = e?.message ? String(e.message) : String(e);
    await prisma.manualTradeLog.create({
      data: {
        workspaceId,
        userId: user.id,
        botId: bot.id,
        symbol: bot.symbol,
        type: "LIMIT",
        side: side.toUpperCase(),
        qty,
        price,
        notional: price * qty,
        postOnly,
        timeInForce: data.timeInForce ?? "GTC",
        clientOrderId,
        status: "REJECTED",
        error: errMsg
      }
    }).catch(() => {});
    res.status(400).json({ error: errMsg });
  }
});

app.post("/bots/:id/manual/market", requireAuth, requirePermission("trading.manual_market"), requireReauth, async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const user = getUserFromLocals(res);
  const bot = await prisma.bot.findFirst({ where: { id: req.params.id, workspaceId } });
  if (!bot) return res.status(404).json({ error: "not_found" });
  if (bot.exchange.toLowerCase() !== "bitmart") {
    return res.status(400).json({ error: "unsupported_exchange" });
  }

  const data = ManualMarketOrder.parse(req.body);
  const side = data.side.toLowerCase() as "buy" | "sell";
  const qty = parseNumber(data.quantity);
  const notional = parseNumber(data.quoteNotionalUsdt);

  if (side === "buy" && (!Number.isFinite(notional) || notional <= 0)) {
    return res.status(400).json({ error: "invalid_buy_notional" });
  }
  if (side === "sell" && (!Number.isFinite(qty) || qty <= 0)) {
    return res.status(400).json({ error: "invalid_sell_quantity" });
  }

  const cex = await prisma.cexConfig.findUnique({ where: { exchange: bot.exchange } });
  if (!cex?.apiKey || !cex?.apiSecret) {
    return res.status(400).json({ error: "cex_config_missing" });
  }

  const clientOrderId = `man_${bot.id}_${Date.now().toString(36)}`;
  const baseUrl = process.env.BITMART_BASE_URL || "https://api-cloud.bitmart.com";
  const rest = new BitmartRestClient(baseUrl, cex.apiKey, cex.apiSecret, cex.apiMemo ?? "");

  try {
    const order = await rest.placeOrder({
      symbol: bot.symbol,
      side,
      type: "market",
      qty: side === "sell" ? qty : 0,
      quoteQty: side === "buy" ? notional : undefined,
      clientOrderId
    });

    await prisma.manualTradeLog.create({
      data: {
        workspaceId,
        userId: user.id,
        botId: bot.id,
        symbol: bot.symbol,
        type: "MARKET",
        side: side.toUpperCase(),
        qty: side === "sell" ? qty : undefined,
        notional: side === "buy" ? notional : undefined,
        clientOrderId,
        exchangeOrderId: order.id,
        status: "SUBMITTED"
      }
    });

    await writeAudit({
      workspaceId,
      actorUserId: user.id,
      action: "manual.market.submit",
      entityType: "Bot",
      entityId: bot.id,
      meta: { side, qty: side === "sell" ? qty : undefined, notional: side === "buy" ? notional : undefined, clientOrderId }
    });

    res.json({ exchangeOrderId: order.id, clientOrderId, status: order.status });
  } catch (e: any) {
    const errMsg = e?.message ? String(e.message) : String(e);
    await prisma.manualTradeLog.create({
      data: {
        workspaceId,
        userId: user.id,
        botId: bot.id,
        symbol: bot.symbol,
        type: "MARKET",
        side: side.toUpperCase(),
        qty: side === "sell" ? qty : undefined,
        notional: side === "buy" ? notional : undefined,
        clientOrderId,
        status: "REJECTED",
        error: errMsg
      }
    }).catch(() => {});
    res.status(400).json({ error: errMsg });
  }
});

app.post("/bots/:id/manual/cancel", requireAuth, requirePermission("trading.manual_limit"), requireReauth, async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const bot = await prisma.bot.findFirst({ where: { id: req.params.id, workspaceId } });
  if (!bot) return res.status(404).json({ error: "not_found" });
  if (bot.exchange.toLowerCase() !== "bitmart") {
    return res.status(400).json({ error: "unsupported_exchange" });
  }

  const data = ManualCancelOrder.parse(req.body);
  const cex = await prisma.cexConfig.findUnique({ where: { exchange: bot.exchange } });
  if (!cex?.apiKey || !cex?.apiSecret) {
    return res.status(400).json({ error: "cex_config_missing" });
  }

  const baseUrl = process.env.BITMART_BASE_URL || "https://api-cloud.bitmart.com";
  const rest = new BitmartRestClient(baseUrl, cex.apiKey, cex.apiSecret, cex.apiMemo ?? "");
  await rest.cancelOrder(bot.symbol, data.orderId);
  const user = getUserFromLocals(res);
  await writeAudit({
    workspaceId,
    actorUserId: user.id,
    action: "manual.cancel",
    entityType: "Bot",
    entityId: bot.id,
    meta: { orderId: data.orderId }
  });
  res.json({ ok: true });
});

app.get("/bots/:id/alerts", requireAuth, requirePermission("bots.view"), async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const bot = await prisma.bot.findFirst({ where: { id: req.params.id, workspaceId } });
  if (!bot) return res.status(404).json({ error: "not_found" });
  const limit = Math.min(Number(req.query.limit || "10"), 50);
  const items = await prisma.botAlert.findMany({
    where: { botId: req.params.id },
    orderBy: { createdAt: "desc" },
    take: limit
  });
  res.json(items);
});

app.delete("/bots/:id/alerts", requireAuth, requirePermission("bots.edit_config"), async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const bot = await prisma.bot.findFirst({ where: { id: req.params.id, workspaceId } });
  if (!bot) return res.status(404).json({ error: "not_found" });
  const id = req.params.id;
  const r = await prisma.botAlert.deleteMany({ where: { botId: id } });
  res.json({ ok: true, deleted: r.count });
});

app.get("/bots/:id/exchange-keys", requireAuth, requirePermission("exchange_keys.view_present"), requireReauth, async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const bot = await prisma.bot.findFirst({ where: { id: req.params.id, workspaceId } });
  if (!bot) return res.status(404).json({ error: "not_found" });

  const cfg = await prisma.cexConfig.findUnique({ where: { exchange: bot.exchange } });
  res.json(cfg ? maskCex(cfg) : null);
});

app.put("/bots/:id/exchange-keys", requireAuth, requirePermission("exchange_keys.edit"), requireReauth, async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const bot = await prisma.bot.findFirst({ where: { id: req.params.id, workspaceId } });
  if (!bot) return res.status(404).json({ error: "not_found" });

  const data = CexConfig.parse(req.body);
  if (data.exchange !== bot.exchange) {
    return res.status(400).json({ error: "exchange_mismatch" });
  }

  const cfg = await prisma.cexConfig.upsert({
    where: { exchange: data.exchange },
    update: {
      apiKey: data.apiKey,
      apiSecret: data.apiSecret,
      apiMemo: data.apiMemo
    },
    create: {
      exchange: data.exchange,
      apiKey: data.apiKey,
      apiSecret: data.apiSecret,
      apiMemo: data.apiMemo
    }
  });
  const user = getUserFromLocals(res);
  await writeAudit({
    workspaceId,
    actorUserId: user.id,
    action: "exchange_keys.update",
    entityType: "CexConfig",
    entityId: cfg.id,
    meta: { exchange: data.exchange }
  });
  res.json(maskCex(cfg));
});

app.post("/bots/:id/preview/mm", requireAuth, requirePermission("bots.edit_config"), async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const bot = await prisma.bot.findFirst({ where: { id: req.params.id, workspaceId } });
  if (!bot) return res.status(404).json({ error: "not_found" });
  const payload = z.object({
    mm: MMConfig,
    runtime: z
      .object({
        mid: z.number(),
        freeUsdt: z.number().optional(),
        freeBase: z.number().optional()
      })
      .optional(),
    options: z
      .object({
        includeJitter: z.boolean().optional(),
        seed: z.number().optional()
      })
      .optional()
  }).parse(req.body);

  const mid = payload.runtime?.mid;
  if (!Number.isFinite(mid) || (mid as number) <= 0) {
    return res.status(400).json({ error: "mid_missing" });
  }

  const freeBase = payload.runtime?.freeBase ?? 0;
  const targetBase = payload.mm.budgetBaseToken;
  const inventoryRatio = targetBase > 0 ? freeBase / targetBase : 1;
  const skew = clamp((inventoryRatio - 1) * payload.mm.skewFactor, -payload.mm.maxSkew, payload.mm.maxSkew);

  const quotes = buildMmQuotes({
    symbol: "PREVIEW",
    mid: mid as number,
    cfg: payload.mm,
    inventoryRatio,
    includeJitter: payload.options?.includeJitter ?? false,
    seed: payload.options?.seed
  });

  const bids = quotes
    .filter((q) => q.side === "buy")
    .map((q) => ({ price: q.price, qty: q.qty, notional: q.price * q.qty }))
    .sort((a, b) => a.price - b.price)
    .reverse();
  const asks = quotes
    .filter((q) => q.side === "sell")
    .map((q) => ({ price: q.price, qty: q.qty, notional: q.price * q.qty }))
    .sort((a, b) => a.price - b.price);

  res.json({ mid, bids, asks, inventoryRatio, skewPct: skew * 100, skewedMid: (mid as number) * (1 + skew) });
});

app.get("/exchanges/:exchange/symbols", requireAuth, async (req, res) => {
  const exchange = req.params.exchange.toLowerCase();
  if (exchange !== "bitmart") {
    return res.status(400).json({ error: "unsupported_exchange" });
  }

  const baseUrl = process.env.BITMART_BASE_URL || "https://api-cloud.bitmart.com";
  const url = new URL("/spot/v1/symbols", baseUrl);

  const resp = await fetch(url, { method: "GET" });
  const json = await resp.json().catch(() => ({}));

  if (!resp.ok || (json?.code && json.code !== 1000)) {
    const msg = json?.msg || json?.message || "symbols fetch failed";
    return res.status(400).json({ error: msg, details: json });
  }

  const symbols = Array.isArray(json?.data?.symbols)
    ? json.data.symbols
    : Array.isArray(json?.data)
      ? json.data
      : [];

  const mapped = symbols
    .map((s: any) => {
      if (typeof s === "string") {
        const parts = s.split(/[_/-]/);
        const base = parts[0];
        const quote = parts[1];
        return { symbol: s, base, quote };
      }

      const rawSymbol =
        s?.symbol ||
        s?.symbol_id ||
        s?.symbolId ||
        s?.trade_symbol ||
        s?.trading_pair;
      const symbol = rawSymbol ? String(rawSymbol) : "";
      let base = s?.base_currency || s?.baseCurrency || s?.base || s?.baseToken;
      let quote = s?.quote_currency || s?.quoteCurrency || s?.quote || s?.quoteToken;

      if ((!base || !quote) && symbol) {
        const parts = symbol.split(/[_/-]/);
        if (parts.length >= 2) {
          base = base || parts[0];
          quote = quote || parts[1];
        }
      }

      if (!symbol) return null;
      return { symbol, base: base ? String(base) : undefined, quote: quote ? String(quote) : undefined };
    })
    .filter(Boolean);

  if (mapped.length === 0) {
    return res.status(502).json({ error: "symbols_unavailable", details: json });
  }

  const unique = Array.from(new Map(mapped.map((s: any) => [s.symbol, s])).values());
  const usdtOnly = unique.filter((s: any) => String(s.quote || "").toUpperCase() === "USDT");
  res.json(usdtOnly.length > 0 ? usdtOnly : unique);
});

app.get("/settings/cex/:exchange", requireAuth, requirePermission("exchange_keys.view_present"), requireReauth, async (req, res) => {
  const exchange = req.params.exchange;
  const cfg = await prisma.cexConfig.findUnique({ where: { exchange } });
  res.json(cfg ? maskCex(cfg) : null);
});

app.get("/settings/cex", requireAuth, requirePermission("exchange_keys.view_present"), requireReauth, async (_req, res) => {
  const items = await prisma.cexConfig.findMany({ orderBy: { updatedAt: "desc" } });
  const masked = items.map((cfg) => ({
    exchange: cfg.exchange,
    apiKey: cfg.apiKey ? `${cfg.apiKey.slice(0, 4)}...${cfg.apiKey.slice(-4)}` : "",
    apiSecret: cfg.apiSecret ? "********" : "",
    apiMemo: cfg.apiMemo ?? null,
    updatedAt: cfg.updatedAt
  }));
  res.json(masked);
});

app.get("/settings/alerts", requireAuth, async (_req, res) => {
  const cfg = await prisma.alertConfig.findUnique({ where: { key: "default" } });
  res.json(cfg ?? { telegramBotToken: null, telegramChatId: null });
});

app.get("/settings/security", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { autoLogoutEnabled: true, autoLogoutMinutes: true }
  });
  const otpEnabled = await getReauthOtpEnabled();
  res.json({
    autoLogoutEnabled: dbUser?.autoLogoutEnabled ?? true,
    autoLogoutMinutes: dbUser?.autoLogoutMinutes ?? 60,
    reauthOtpEnabled: otpEnabled,
    isSuperadmin: isSuperadmin(user)
  });
});

app.delete("/settings/cex/:exchange", requireAuth, requirePermission("exchange_keys.edit"), requireReauth, async (req, res) => {
  const exchange = req.params.exchange;
  await prisma.cexConfig.delete({ where: { exchange } });
  res.json({ ok: true });
});

app.post("/bots", requireAuth, requirePermission("bots.create"), async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const user = getUserFromLocals(res);
  const data = BotCreate.parse(req.body);
  const id = crypto.randomUUID();

  const bot = await prisma.bot.create({
    data: {
      id,
      workspaceId,
      name: data.name,
      symbol: data.symbol,
      exchange: data.exchange,
      status: "STOPPED",
      mmEnabled: true,
      volEnabled: true,
      mmConfig: {
        create: {
          spreadPct: 0.004,
          maxSpreadPct: 0.0015,
          levelsUp: 5,
          levelsDown: 5,
          budgetQuoteUsdt: 2000,
          budgetBaseToken: 2000,
          minOrderUsdt: 5,
          maxOrderUsdt: 0,
          distribution: "VALLEY",
          jitterPct: 0.0002,
          skewFactor: 0.25,
          maxSkew: 0.006
        }
      },
      volConfig: {
        create: {
          dailyNotionalUsdt: 5000,
          minTradeUsdt: 10,
          maxTradeUsdt: 40,
          activeFrom: "00:00",
          activeTo: "23:59",
          mode: "MIXED",
          buyPct: 0.5,
          buyBumpTicks: 0,
          sellBumpTicks: 0
        }
      },
      riskConfig: {
        create: {
          minUsdt: 200,
          maxDeviationPct: 0.8,
          maxOpenOrders: 30,
          maxDailyLoss: 200
        }
      },
      notificationConfig: {
        create: {
          fundsWarnEnabled: true,
          fundsWarnPct: 0.1
        }
      },
      priceSupportConfig: {
        create: {
          enabled: false,
          active: true,
          floorPrice: null,
          budgetUsdt: 0,
          spentUsdt: 0,
          maxOrderUsdt: 50,
          cooldownMs: 2000,
          mode: "PASSIVE",
          lastActionAt: BigInt(0),
          stoppedReason: null,
          notifiedBudgetExhaustedAt: BigInt(0)
        }
      }
    }
  });

  await prisma.botRuntime.upsert({
    where: { botId: bot.id },
    create: {
      botId: bot.id,
      status: "STOPPED",
      reason: "Created"
    },
    update: {
      status: "STOPPED",
      reason: "Created"
    }
  });

  await writeAudit({
    workspaceId,
    actorUserId: user.id,
    action: "bots.create",
    entityType: "Bot",
    entityId: bot.id,
    meta: { name: bot.name, symbol: bot.symbol }
  });

  res.json(bot);
});

app.put("/bots/:id/config", requireAuth, requirePermission("bots.edit_config"), async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const user = getUserFromLocals(res);
  const botId = req.params.id;

  const payload = z.object({
    mm: MMConfig,
    vol: VolConfig,
    risk: RiskConfig,
    notify: NotificationConfig,
    priceSupport: PriceSupportConfig.optional()
  }).parse(req.body);

  if (!isSuperadmin(user) && !roleAllows(res, "risk.edit")) {
    return res.status(403).json({ error: "forbidden" });
  }

  const errors: Record<string, string> = {};
  const minQuoteUsdt = 100;

  if (payload.mm.budgetQuoteUsdt < minQuoteUsdt) {
    errors.budgetQuoteUsdt = `Minimum ${minQuoteUsdt} USDT`;
  }

  const bot = await prisma.bot.findFirst({ where: { id: botId, workspaceId } });
  if (!bot) return res.status(404).json({ error: "not_found" });
  const rt = await prisma.botRuntime.findUnique({ where: { botId } });
  const mid = rt?.mid ?? null;

  if (mid && mid > 0) {
    const minBaseToken = minQuoteUsdt / mid;
    if (payload.mm.budgetBaseToken < minBaseToken) {
      const base = bot?.symbol?.split("_")[0] || "Token";
      errors.budgetBaseToken = `Minimum ~${minBaseToken.toFixed(6)} ${base}`;
    }
  }

  const features = await getWorkspaceFeatures(workspaceId);
  const priceSupportFeature = Boolean(features?.priceSupport);
  if (payload.priceSupport && !priceSupportFeature) {
    return res.status(403).json({ error: "feature_disabled" });
  }

  if (payload.priceSupport?.enabled) {
    if (!payload.priceSupport.floorPrice || payload.priceSupport.floorPrice <= 0) {
      errors.floorPrice = "Floor price required";
    }
    if (payload.priceSupport.budgetUsdt <= 0) {
      errors.budgetUsdt = "Budget must be > 0";
    }
    if (payload.priceSupport.maxOrderUsdt <= 0) {
      errors.maxOrderUsdt = "Max order must be > 0";
    }
    if (payload.priceSupport.cooldownMs < 0) {
      errors.cooldownMs = "Cooldown must be >= 0";
    }
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: "min_budget", details: { errors } });
  }

  if (!isSuperadmin(user)) {
    delete (payload.vol as any).buyBumpTicks;
    delete (payload.vol as any).sellBumpTicks;
  }

  await prisma.marketMakingConfig.update({
    where: { botId },
    data: payload.mm
  });

  await prisma.volumeConfig.update({
    where: { botId },
    data: payload.vol
  });

  await prisma.riskConfig.update({
    where: { botId },
    data: payload.risk
  });

  await prisma.botNotificationConfig.upsert({
    where: { botId },
    update: payload.notify,
    create: { botId, ...payload.notify }
  });

  if (payload.priceSupport) {
    const existing = await prisma.botPriceSupportConfig.findUnique({ where: { botId } });
    const updateData: any = {
      enabled: payload.priceSupport.enabled,
      floorPrice: payload.priceSupport.floorPrice,
      budgetUsdt: payload.priceSupport.budgetUsdt,
      maxOrderUsdt: payload.priceSupport.maxOrderUsdt,
      cooldownMs: payload.priceSupport.cooldownMs,
      mode: payload.priceSupport.mode
    };
    if (!existing) {
      await prisma.botPriceSupportConfig.create({
        data: {
          botId,
          active: true,
          spentUsdt: 0,
          lastActionAt: BigInt(0),
          stoppedReason: null,
          notifiedBudgetExhaustedAt: BigInt(0),
          ...updateData
        }
      });
    } else {
      await prisma.botPriceSupportConfig.update({
        where: { botId },
        data: updateData
      });
    }
  }

  await writeAudit({
    workspaceId,
    actorUserId: user.id,
    action: "bots.update_config",
    entityType: "Bot",
    entityId: botId
  });

  res.json({ ok: true });
});

app.post("/bots/:id/price-support/restart", requireAuth, requirePermission("trading.price_support"), async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const user = getUserFromLocals(res);
  const botId = req.params.id;
  const features = await getWorkspaceFeatures(workspaceId);
  if (!features?.priceSupport) {
    return res.status(403).json({ error: "feature_disabled" });
  }

  const bot = await prisma.bot.findFirst({ where: { id: botId, workspaceId } });
  if (!bot) return res.status(404).json({ error: "not_found" });

  await prisma.botPriceSupportConfig.upsert({
    where: { botId },
    create: {
      botId,
      enabled: false,
      active: true,
      floorPrice: null,
      budgetUsdt: 0,
      spentUsdt: 0,
      maxOrderUsdt: 50,
      cooldownMs: 2000,
      mode: "PASSIVE",
      lastActionAt: BigInt(0),
      stoppedReason: null,
      notifiedBudgetExhaustedAt: BigInt(0)
    },
    update: {
      active: true,
      stoppedReason: null,
      notifiedBudgetExhaustedAt: BigInt(0)
    }
  });

  await writeAudit({
    workspaceId,
    actorUserId: user.id,
    action: "bots.price_support.restart",
    entityType: "Bot",
    entityId: botId
  });

  res.json({ ok: true });
});

app.post("/bots/:id/mm/start", requireAuth, requirePermission("bots.start_pause_stop"), async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const user = getUserFromLocals(res);
  const botId = req.params.id;
  const bot = await prisma.bot.findFirst({ where: { id: botId, workspaceId } });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });
  await prisma.bot.update({ where: { id: botId }, data: { mmEnabled: true } });
  await writeAudit({
    workspaceId,
    actorUserId: user.id,
    action: "bots.mm.start",
    entityType: "Bot",
    entityId: botId
  });
  await sendTelegramWithFallback(`✅ MM started\n${bot.name} (${bot.symbol})`);
  res.json({ ok: true });
});

app.post("/bots/:id/mm/stop", requireAuth, requirePermission("bots.start_pause_stop"), async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const user = getUserFromLocals(res);
  const botId = req.params.id;
  const bot = await prisma.bot.findFirst({ where: { id: botId, workspaceId } });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });
  await prisma.bot.update({ where: { id: botId }, data: { mmEnabled: false } });
  await writeAudit({
    workspaceId,
    actorUserId: user.id,
    action: "bots.mm.stop",
    entityType: "Bot",
    entityId: botId
  });
  await sendTelegramWithFallback(`🛑 MM stopped\n${bot.name} (${bot.symbol})`);
  res.json({ ok: true });
});

app.post("/bots/:id/vol/start", requireAuth, requirePermission("bots.start_pause_stop"), async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const user = getUserFromLocals(res);
  const botId = req.params.id;
  const bot = await prisma.bot.findFirst({ where: { id: botId, workspaceId } });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });
  await prisma.bot.update({ where: { id: botId }, data: { volEnabled: true } });
  await writeAudit({
    workspaceId,
    actorUserId: user.id,
    action: "bots.vol.start",
    entityType: "Bot",
    entityId: botId
  });
  await sendTelegramWithFallback(`✅ Volume bot started\n${bot.name} (${bot.symbol})`);
  res.json({ ok: true });
});

app.post("/bots/:id/vol/stop", requireAuth, requirePermission("bots.start_pause_stop"), async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const user = getUserFromLocals(res);
  const botId = req.params.id;
  const bot = await prisma.bot.findFirst({ where: { id: botId, workspaceId } });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });
  await prisma.bot.update({ where: { id: botId }, data: { volEnabled: false } });
  await writeAudit({
    workspaceId,
    actorUserId: user.id,
    action: "bots.vol.stop",
    entityType: "Bot",
    entityId: botId
  });
  await sendTelegramWithFallback(`🛑 Volume bot stopped\n${bot.name} (${bot.symbol})`);
  res.json({ ok: true });
});

app.put("/settings/cex", requireAuth, requirePermission("exchange_keys.edit"), requireReauth, async (req, res) => {
  const data = CexConfig.parse(req.body);
  const cfg = await prisma.cexConfig.upsert({
    where: { exchange: data.exchange },
    update: {
      apiKey: data.apiKey,
      apiSecret: data.apiSecret,
      apiMemo: data.apiMemo
    },
    create: {
      exchange: data.exchange,
      apiKey: data.apiKey,
      apiSecret: data.apiSecret,
      apiMemo: data.apiMemo
    }
  });
  res.json(cfg);
});

app.put("/settings/alerts", requireAuth, async (req, res) => {
  const data = AlertConfig.parse(req.body);
  const cfg = await prisma.alertConfig.upsert({
    where: { key: "default" },
    update: {
      telegramBotToken: data.telegramBotToken ?? null,
      telegramChatId: data.telegramChatId ?? null
    },
    create: {
      key: "default",
      telegramBotToken: data.telegramBotToken ?? null,
      telegramChatId: data.telegramChatId ?? null
    }
  });
  res.json(cfg);
});

app.put("/settings/security", requireAuth, async (req, res) => {
  const data = SecuritySettings.parse(req.body);
  const user = getUserFromLocals(res);
  if (data.reauthOtpEnabled !== undefined && !isSuperadmin(user)) {
    return res.status(403).json({ error: "forbidden" });
  }

  let otpEnabled = await getReauthOtpEnabled();
  if (data.reauthOtpEnabled !== undefined) {
    otpEnabled = Boolean(data.reauthOtpEnabled);
    await prisma.globalSetting.upsert({
      where: { key: "security.reauth_otp_enabled" },
      update: { value: otpEnabled },
      create: { key: "security.reauth_otp_enabled", value: otpEnabled }
    });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      autoLogoutEnabled: data.autoLogoutEnabled,
      autoLogoutMinutes: data.autoLogoutMinutes
    }
  });
  await writeAudit({
    workspaceId: getWorkspaceId(res),
    actorUserId: user.id,
    action: "settings.security.update",
    entityType: "User",
    entityId: user.id,
    meta: {
      autoLogoutEnabled: updated.autoLogoutEnabled,
      autoLogoutMinutes: updated.autoLogoutMinutes,
      reauthOtpEnabled: otpEnabled
    }
  });
  res.json({
    autoLogoutEnabled: updated.autoLogoutEnabled,
    autoLogoutMinutes: updated.autoLogoutMinutes,
    reauthOtpEnabled: otpEnabled,
    isSuperadmin: isSuperadmin(user)
  });
});

app.post("/settings/cex/verify", requireAuth, requirePermission("exchange_keys.edit"), requireReauth, async (req, res) => {
  const data = CexConfig.parse(req.body);

  // Minimal auth-protected call: balances requires signed headers.
  const baseUrl = process.env.BITMART_BASE_URL || "https://api-cloud.bitmart.com";
  const url = new URL("/spot/v1/wallet", baseUrl);
  const timestamp = Date.now().toString();
  const body = "{}";
  const payload = `${timestamp}#${data.apiMemo ?? ""}#${body}`;
  const sign = crypto
    .createHmac("sha256", data.apiSecret)
    .update(payload)
    .digest("hex");

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "X-BM-KEY": data.apiKey,
      "X-BM-SIGN": sign,
      "X-BM-TIMESTAMP": timestamp,
      "Content-Type": "application/json"
    }
  });

  const json = await resp.json().catch(() => ({}));

  if (!resp.ok || (json?.code && json.code !== 1000)) {
    const msg = json?.msg || json?.message || "verify failed";
    return res.status(400).json({ ok: false, error: msg, details: json });
  }

  res.json({ ok: true });
});

app.post("/bots/:id/start", requireAuth, requirePermission("bots.start_pause_stop"), async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const user = getUserFromLocals(res);
  const id = req.params.id;

  const bot = await prisma.bot.findFirst({ where: { id, workspaceId } });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });

  await prisma.bot.update({
    where: { id },
    data: { status: "RUNNING" }
  });

  await prisma.botRuntime.upsert({
    where: { botId: id },
    create: {
      botId: id,
      status: "RUNNING",
      reason: null
    },
    update: {
      status: "RUNNING",
      reason: null
    }
  });

  await createBotAlert({
    botId: id,
    level: "info",
    title: "Bot started",
    message: "Start command received"
  });

  await sendTelegramWithFallback(`✅ Bot started\n${bot.name} (${bot.symbol})`);

  await writeAudit({
    workspaceId,
    actorUserId: user.id,
    action: "runner.start",
    entityType: "Bot",
    entityId: id
  });

  res.json({ ok: true });
});

app.post("/bots/:id/pause", requireAuth, requirePermission("bots.start_pause_stop"), async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const user = getUserFromLocals(res);
  const id = req.params.id;

  const bot = await prisma.bot.findFirst({ where: { id, workspaceId } });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });

  await prisma.bot.update({
    where: { id },
    data: { status: "PAUSED" }
  });

  await prisma.botRuntime.upsert({
    where: { botId: id },
    create: {
      botId: id,
      status: "PAUSED",
      reason: "Paused from UI"
    },
    update: {
      status: "PAUSED",
      reason: "Paused from UI"
    }
  });

  await createBotAlert({
    botId: id,
    level: "warn",
    title: "Bot paused",
    message: "Pause command received"
  });

  await writeAudit({
    workspaceId,
    actorUserId: user.id,
    action: "runner.pause",
    entityType: "Bot",
    entityId: id
  });

  res.json({ ok: true });
});

app.post("/bots/:id/stop", requireAuth, requirePermission("bots.start_pause_stop"), async (req, res) => {
  const workspaceId = getWorkspaceId(res);
  const user = getUserFromLocals(res);
  const id = req.params.id;

  const bot = await prisma.bot.findFirst({ where: { id, workspaceId } });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });

  await prisma.bot.update({
    where: { id },
    data: { status: "STOPPED" }
  });

  await prisma.botRuntime.upsert({
    where: { botId: id },
    create: {
      botId: id,
      status: "STOPPED",
      reason: "Stopped from UI"
    },
    update: {
      status: "STOPPED",
      reason: "Stopped from UI"
    }
  });

  await createBotAlert({
    botId: id,
    level: "warn",
    title: "Bot stopped",
    message: "Stop command received"
  });

  await sendTelegramWithFallback(`🛑 Bot stopped\n${bot.name} (${bot.symbol})`);

  await writeAudit({
    workspaceId,
    actorUserId: user.id,
    action: "runner.stop",
    entityType: "Bot",
    entityId: id
  });

  res.json({ ok: true });
});

const port = Number(process.env.API_PORT || "8080");

async function start() {
  const seed = await seedAdmin();
  if (!seed.seeded) {
    console.log(`[seed] admin not created (${seed.reason})`);
  }
  app.listen(port, () => console.log(`API listening on :${port}`));
}

start().catch((err) => {
  console.error("API startup failed", err);
  process.exit(1);
});

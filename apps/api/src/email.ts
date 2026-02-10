import nodemailer from "nodemailer";
import { prisma } from "@mm/db";
import { decryptSecret } from "./secret-crypto.js";

const db = prisma as any;
const SMTP_GLOBAL_KEY = "admin.smtp";

type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parsePort(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num <= 0 || num > 65535) return null;
  return Math.floor(num);
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return null;
}

async function readDbSmtpConfig(): Promise<Partial<SmtpConfig>> {
  const row = await db.globalSetting.findUnique({
    where: { key: SMTP_GLOBAL_KEY },
    select: { value: true }
  });
  const value = asRecord(row?.value);
  const host = parseString(value.host);
  const port = parsePort(value.port);
  const user = parseString(value.user);
  const from = parseString(value.from);
  const secureRaw = parseBoolean(value.secure);
  const passEnc = parseString(value.passEnc);
  let pass: string | null = null;
  if (passEnc) {
    try {
      pass = parseString(decryptSecret(passEnc));
    } catch {
      pass = null;
    }
  }
  return {
    host: host ?? undefined,
    port: port ?? undefined,
    user: user ?? undefined,
    from: from ?? undefined,
    pass: pass ?? undefined,
    secure: secureRaw ?? undefined
  };
}

export async function resolveSmtpConfig(): Promise<SmtpConfig | null> {
  const envHost = parseString(process.env.SMTP_HOST);
  const envPort = parsePort(process.env.SMTP_PORT);
  const envUser = parseString(process.env.SMTP_USER);
  const envPass = parseString(process.env.SMTP_PASS);
  const envFrom = parseString(process.env.SMTP_FROM);
  const envSecure = parseBoolean(process.env.SMTP_SECURE);

  const dbConfig = await readDbSmtpConfig();
  const host = envHost ?? dbConfig.host ?? null;
  const port = envPort ?? dbConfig.port ?? null;
  const user = envUser ?? dbConfig.user ?? null;
  const pass = envPass ?? dbConfig.pass ?? null;
  const from = envFrom ?? dbConfig.from ?? null;
  const secure = envSecure ?? dbConfig.secure ?? (port === 465);

  if (!host || !port || !user || !pass || !from) return null;
  return { host, port, user, pass, from, secure };
}

function createTransport(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass }
  });
}

export async function sendSmtpTestEmail(params: { to: string; subject?: string; text?: string }) {
  const cfg = await resolveSmtpConfig();
  if (!cfg) return { ok: false, error: "smtp_not_configured" };

  const transporter = createTransport(cfg);
  try {
    await transporter.sendMail({
      from: cfg.from,
      to: params.to,
      subject: params.subject ?? "uTrade SMTP Test",
      text:
        params.text ??
        [
          "SMTP test successful.",
          `Time: ${new Date().toISOString()}`
        ].join("\n")
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ? String(e.message) : String(e) };
  }
}

export async function sendInviteEmail(params: {
  to: string;
  workspaceName: string;
  invitedByEmail: string;
  tempPassword?: string | null;
  baseUrl: string;
}) {
  const cfg = await resolveSmtpConfig();
  if (!cfg) return { ok: false, error: "smtp_not_configured" };

  const transporter = createTransport(cfg);

  const loginUrl = `${params.baseUrl.replace(/\/$/, "")}/login`;
  const lines = [
    `You have been invited to the workspace \"${params.workspaceName}\".`,
    `Invited by: ${params.invitedByEmail}`,
    "",
    `Login: ${loginUrl}`
  ];

  if (params.tempPassword) {
    lines.push("", `Temporary password: ${params.tempPassword}`, "Please change it after login.");
  }

  const text = lines.join("\n");

  try {
    await transporter.sendMail({
      from: cfg.from,
      to: params.to,
      subject: "Workspace invitation (uLiquid)",
      text
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ? String(e.message) : String(e) };
  }
}

export async function sendReauthOtpEmail(params: {
  to: string;
  code: string;
  expiresAt: Date;
}) {
  const cfg = await resolveSmtpConfig();
  if (!cfg) return { ok: false, error: "smtp_not_configured" };

  const transporter = createTransport(cfg);

  const expiresLocal = params.expiresAt.toLocaleString();
  const text = [
    "Your re-authentication code:",
    params.code,
    "",
    `Expires at: ${expiresLocal}`
  ].join("\n");

  try {
    await transporter.sendMail({
      from: cfg.from,
      to: params.to,
      subject: "uLiquid re-authentication code",
      text
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ? String(e.message) : String(e) };
  }
}

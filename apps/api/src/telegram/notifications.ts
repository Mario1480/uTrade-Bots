import { prisma } from "@mm/db";
import type { PredictionSignalSource } from "../ai/predictionPipeline.js";
import { listEconomicEvents } from "../services/economicCalendar/index.js";
import type { EconomicEventView } from "../services/economicCalendar/types.js";
import { normalizeTelegramChatId as normalizeTelegramChatIdValue } from "./chatIdUniqueness.js";
import type { DailyEconomicCalendarSettings } from "./dailyEconomicCalendarSettings.js";
import { getLocalDateTimeByTimezone } from "./dailyEconomicCalendarSettings.js";

const db = prisma as any;
const TELEGRAM_TEXT_MAX_CHARS = 3900;

type PredictionTimeframe = "5m" | "15m" | "1h" | "4h" | "1d";
type PredictionMarketType = "spot" | "perp";
type PredictionSignal = "up" | "down" | "neutral";

export type TelegramConfig = {
  botToken: string;
  chatId: string;
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function parseTelegramConfigValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTelegramChatId(value: unknown): string | null {
  return normalizeTelegramChatIdValue(value);
}

function confidenceToPct(value: number): number {
  const normalized = value <= 1 ? value * 100 : value;
  return clamp(normalized, 0, 100);
}

function isTradableSignal(params: {
  signal: PredictionSignal;
  confidence: number;
  confidenceTargetPct: number;
}): boolean {
  if (params.signal !== "up" && params.signal !== "down") return false;
  if (!Number.isFinite(params.confidence)) return false;
  const confidencePct = confidenceToPct(params.confidence);
  return confidencePct >= clamp(params.confidenceTargetPct, 0, 100);
}

function resolvePanelBaseUrl(): string {
  const configured =
    (typeof process.env.PANEL_BASE_URL === "string" ? process.env.PANEL_BASE_URL : null) ??
    (typeof process.env.INVITE_BASE_URL === "string" ? process.env.INVITE_BASE_URL : null) ??
    "http://localhost:3000";
  return configured.trim().replace(/\/+$/, "") || "http://localhost:3000";
}

function buildManualDeskPredictionLink(predictionId: string | null): string | null {
  if (!predictionId) return null;
  try {
    const url = new URL("/trading-desk", `${resolvePanelBaseUrl()}/`);
    url.searchParams.set("predictionId", predictionId);
    return url.toString();
  } catch {
    return null;
  }
}

function buildTelegramText(lines: Array<string | null | undefined>): string {
  const text = lines.filter((line): line is string => Boolean(line)).join("\n");
  if (text.length <= TELEGRAM_TEXT_MAX_CHARS) return text;
  const truncated = text.slice(0, TELEGRAM_TEXT_MAX_CHARS - 14).trimEnd();
  return `${truncated}\n…[truncated]`;
}

function shiftDateKey(dateKey: string, days: number): string {
  const base = new Date(`${dateKey}T00:00:00.000Z`);
  const shifted = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function formatTimeInTimezone(tsIso: string, timezone: string): string {
  const date = new Date(tsIso);
  if (Number.isNaN(date.getTime())) return "--:--";
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  return formatter.format(date);
}

export function filterEconomicEventsByLocalDate(params: {
  events: EconomicEventView[];
  timezone: string;
  localDate: string;
}): EconomicEventView[] {
  return params.events
    .filter((event) => {
      const local = getLocalDateTimeByTimezone(new Date(event.ts), params.timezone);
      return local.localDate === params.localDate;
    })
    .sort((left, right) => {
      const leftTs = new Date(left.ts).getTime();
      const rightTs = new Date(right.ts).getTime();
      return leftTs - rightTs;
    });
}

export async function sendDailyEconomicCalendarDigestForUser(params: {
  userId: string;
  settings: Pick<DailyEconomicCalendarSettings, "currencies" | "impacts" | "timezone">;
  now?: Date;
  dbClient?: any;
}): Promise<{ sent: boolean; eventCount: number; localDate: string; reason?: string }> {
  const config = await resolveTelegramConfig(params.userId);
  const now = params.now ?? new Date();
  const localNow = getLocalDateTimeByTimezone(now, params.settings.timezone);

  if (!config) {
    return {
      sent: false,
      eventCount: 0,
      localDate: localNow.localDate,
      reason: "telegram_not_configured"
    };
  }

  const from = shiftDateKey(localNow.localDate, -1);
  const to = shiftDateKey(localNow.localDate, 1);
  const events = await listEconomicEvents({
    db: params.dbClient ?? db,
    from,
    to,
    currencies: params.settings.currencies,
    impactMin: "low",
    impacts: params.settings.impacts
  });
  const eventsForLocalDay = filterEconomicEventsByLocalDate({
    events,
    timezone: params.settings.timezone,
    localDate: localNow.localDate
  });

  const text = buildTelegramText([
    "🗓 DAILY ECONOMIC CALENDAR",
    `Date: ${localNow.localDate} (${params.settings.timezone})`,
    `Currencies: ${params.settings.currencies.join(", ")}`,
    `Impact: ${params.settings.impacts.join(", ")}`,
    ...(
      eventsForLocalDay.length === 0
        ? ["No matching economic calendar events for today."]
        : eventsForLocalDay.map((event) => {
            const time = formatTimeInTimezone(event.ts, params.settings.timezone);
            const impact = String(event.impact).trim().toUpperCase();
            return `• ${time} ${event.currency} [${impact}] ${event.title} (${event.country})`;
          })
    )
  ]);

  await sendTelegramMessage({
    ...config,
    text
  });

  return {
    sent: true,
    eventCount: eventsForLocalDay.length,
    localDate: localNow.localDate
  };
}

export async function resolveTelegramConfig(userId?: string | null): Promise<TelegramConfig | null> {
  const envToken = parseTelegramConfigValue(process.env.TELEGRAM_BOT_TOKEN);
  const envChatId = normalizeTelegramChatId(process.env.TELEGRAM_CHAT_ID);
  const envOverrideEnabled = Boolean(envToken && envChatId);
  const config = await db.alertConfig.findUnique({
    where: { key: "default" },
    select: {
      telegramBotToken: true,
      telegramChatId: true
    }
  });

  const botToken = envOverrideEnabled
    ? envToken
    : parseTelegramConfigValue(config?.telegramBotToken);
  let chatId: string | null = null;
  if (userId) {
    const userSettings = await db.user.findUnique({
      where: { id: userId },
      select: {
        telegramChatId: true
      }
    });
    chatId = normalizeTelegramChatId(userSettings?.telegramChatId);
  }
  if (!chatId) {
    chatId = envOverrideEnabled
      ? envChatId
      : normalizeTelegramChatId(config?.telegramChatId);
  }

  if (!botToken || !chatId) return null;

  return { botToken, chatId };
}

export async function sendTelegramMessage(params: TelegramConfig & {
  text: string;
  linkButton?: { text: string; url: string } | null;
}): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const sendPayload = async (withLinkButton: boolean): Promise<Response> => fetch(
      `https://api.telegram.org/bot${params.botToken}/sendMessage`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          chat_id: params.chatId,
          text: params.text,
          disable_web_page_preview: true,
          ...(withLinkButton && params.linkButton
            ? {
                reply_markup: {
                  inline_keyboard: [[{
                    text: params.linkButton.text,
                    url: params.linkButton.url
                  }]]
                }
              }
            : {})
        }),
        signal: controller.signal
      }
    );

    let response = await sendPayload(Boolean(params.linkButton));
    let responseBody = await response.text();
    if (!response.ok && params.linkButton && response.status === 400) {
      const lower = responseBody.toLowerCase();
      const mayBeInvalidButtonUrl = lower.includes("button") && lower.includes("url");
      if (mayBeInvalidButtonUrl) {
        response = await sendPayload(false);
        responseBody = await response.text();
      }
    }

    let payload: { ok?: boolean; description?: string } = {};
    try {
      payload = JSON.parse(responseBody) as { ok?: boolean; description?: string };
    } catch {
      payload = {};
    }
    if (!response.ok || payload.ok === false) {
      const details = typeof payload.description === "string" ? payload.description : responseBody;
      throw new Error(`telegram_api_failed:${response.status}:${details}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function notifyTradablePrediction(params: {
  userId: string;
  exchange: string;
  exchangeAccountLabel: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  signal: PredictionSignal;
  confidence: number;
  confidenceTargetPct: number;
  expectedMovePct: number;
  predictionId: string | null;
  explanation?: string | null;
  source: "manual" | "auto";
  signalSource: PredictionSignalSource;
  aiPromptTemplateName?: string | null;
}): Promise<void> {
  if (!isTradableSignal({
    signal: params.signal,
    confidence: params.confidence,
    confidenceTargetPct: params.confidenceTargetPct
  })) {
    return;
  }

  const config = await resolveTelegramConfig(params.userId);
  if (!config) {
    return;
  }

  const confidencePct = confidenceToPct(params.confidence);
  const signalLabel = params.signal === "up" ? "LONG" : "SHORT";
  const explanation = typeof params.explanation === "string" ? params.explanation.trim() : "";
  const promptName =
    typeof params.aiPromptTemplateName === "string" && params.aiPromptTemplateName.trim()
      ? params.aiPromptTemplateName.trim()
      : null;
  const deskLink = buildManualDeskPredictionLink(params.predictionId);

  const text = buildTelegramText([
    "🆕 SIGNAL ALERT",
    `${params.symbol} (${params.marketType}, ${params.timeframe})`,
    `Signal: ${signalLabel}`,
    `Source: ${params.signalSource}`, 
    `Strategy: ${promptName ?? "n/a"}`,
    `Confidence: ${confidencePct.toFixed(1)}% (target ${params.confidenceTargetPct.toFixed(0)}%)`,
    `Expected move: ${params.expectedMovePct.toFixed(2)}%`,
    `Exchange: ${params.exchangeAccountLabel}`,
    explanation ? `Reason: ${explanation}` : null
  ]);

  try {
    await sendTelegramMessage({
      ...config,
      text,
      linkButton: deskLink ? { text: "Open Trading Desk", url: deskLink } : null
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[telegram] prediction notification failed", {
      userId: params.userId,
      predictionId: params.predictionId ?? null,
      reason: String(error)
    });
  }
}

export async function notifyMarketAnalysisUpdate(params: {
  userId: string;
  exchange: string;
  exchangeAccountLabel: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  signal: PredictionSignal;
  confidence: number;
  expectedMovePct: number;
  predictionId: string | null;
  explanation?: string | null;
  source: "manual" | "auto";
  signalSource: PredictionSignalSource;
  aiPromptTemplateName?: string | null;
}): Promise<void> {
  const config = await resolveTelegramConfig(params.userId);
  if (!config) return;

  const promptName =
    typeof params.aiPromptTemplateName === "string" && params.aiPromptTemplateName.trim()
      ? params.aiPromptTemplateName.trim()
      : null;
  const explanation = typeof params.explanation === "string" ? params.explanation.trim() : "";
  const deskLink = buildManualDeskPredictionLink(params.predictionId);
  const confidencePct = confidenceToPct(params.confidence);
  const text = buildTelegramText([
    "📊 MARKET ANALYSIS UPDATE",
    `${params.symbol} (${params.marketType}, ${params.timeframe})`,
    `Source: ${params.signalSource}`,
    `Strategy: ${promptName ?? "n/a"}`,
    explanation ? `Analysis: ${explanation}` : null
  ]);

  try {
    await sendTelegramMessage({
      ...config,
      text
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[telegram] market analysis notification failed", {
      userId: params.userId,
      predictionId: params.predictionId ?? null,
      reason: String(error)
    });
  }
}

export async function notifyPredictionOutcome(params: {
  userId: string;
  exchangeAccountLabel: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  signal: PredictionSignal;
  predictionId: string;
  outcomeResult: "tp_hit" | "sl_hit";
  outcomePnlPct: number | null;
}): Promise<boolean> {
  const config = await resolveTelegramConfig(params.userId);
  if (!config) {
    return false;
  }

  const sideLabel = params.signal === "down" ? "SHORT" : "LONG";
  const outcomeLabel = params.outcomeResult === "tp_hit" ? "TP HIT" : "SL HIT";
  const pnlText = Number.isFinite(params.outcomePnlPct)
    ? `${Number(params.outcomePnlPct).toFixed(2)}%`
    : "n/a";
  const emoji = params.outcomeResult === "tp_hit" ? "✅" : "🛑";

  const lines = [
    `${emoji} SIGNAL OUTCOME`,
    `${params.symbol} (${params.marketType}, ${params.timeframe})`,
    `Side: ${sideLabel}`,
    `Result: ${outcomeLabel}`,
    `PnL: ${pnlText}`,
    `Exchange: ${params.exchangeAccountLabel}`,
    `Signal ID: ${params.predictionId}`
  ];

  try {
    await sendTelegramMessage({
      ...config,
      text: lines.join("\n")
    });
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[telegram] prediction outcome notification failed", {
      userId: params.userId,
      predictionId: params.predictionId,
      outcomeResult: params.outcomeResult,
      reason: String(error)
    });
    return false;
  }
}

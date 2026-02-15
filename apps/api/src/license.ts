import { z } from "zod";
import { prisma } from "@mm/db";

export type Entitlements = {
  maxRunningBots: number;
  maxBotsTotal: number;
  allowedExchanges: string[];
};

export type StrategyLicensePlan = "free" | "pro" | "enterprise";
export type StrategyLicenseKind = "local" | "ai" | "composite";

export type StrategyEntitlements = {
  workspaceId: string;
  plan: StrategyLicensePlan;
  allowedStrategyKinds: StrategyLicenseKind[];
  allowedStrategyIds: string[] | null;
  maxCompositeNodes: number;
  aiAllowedModels: string[] | null;
  aiMonthlyBudgetUsd: number | null;
  source: "db" | "plan_default";
};

export type StrategyAccessDecision = {
  allowed: boolean;
  reason:
    | "ok"
    | "kind_not_allowed"
    | "strategy_id_not_allowed"
    | "ai_model_not_allowed"
    | "composite_nodes_exceeded";
  maxCompositeNodes: number;
};

type StrategyEntitlementsAccessInput = Pick<
  StrategyEntitlements,
  "allowedStrategyKinds" | "allowedStrategyIds" | "maxCompositeNodes" | "aiAllowedModels"
>;

export type AiPromptLicenseMode = "off" | "warn" | "enforce";

export type AiPromptAccessDecision = {
  allowed: boolean;
  reason:
    | "ok"
    | "enforcement_off"
    | "no_prompt_selected"
    | "prompt_not_allowed";
  mode: AiPromptLicenseMode;
  wouldBlock: boolean;
};

export type LicenseDecision = {
  allowed: boolean;
  reason:
    | "ok"
    | "enforcement_off"
    | "max_bots_total_exceeded"
    | "max_running_bots_exceeded"
    | "exchange_not_allowed"
    | "license_server_unreachable";
};

const entitlementsSchema = z.object({
  maxRunningBots: z.number().int().nonnegative(),
  maxBotsTotal: z.number().int().nonnegative(),
  allowedExchanges: z.array(z.string().trim().min(1))
});

const cache = new Map<string, { expiresAt: number; entitlements: Entitlements }>();
const db = prisma as any;
const strategyEntitlementsCache = new Map<string, { expiresAt: number; entitlements: StrategyEntitlements }>();

const STRATEGY_PLAN_DEFAULTS: Record<
  StrategyLicensePlan,
  {
    allowedStrategyKinds: StrategyLicenseKind[];
    maxCompositeNodes: number;
    aiAllowedModels: string[] | null;
  }
> = {
  free: {
    allowedStrategyKinds: ["local"],
    maxCompositeNodes: 0,
    aiAllowedModels: []
  },
  pro: {
    allowedStrategyKinds: ["local", "ai", "composite"],
    maxCompositeNodes: 12,
    aiAllowedModels: null
  },
  enterprise: {
    allowedStrategyKinds: ["local", "ai", "composite"],
    maxCompositeNodes: 64,
    aiAllowedModels: null
  }
};

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function includesExchange(list: string[], exchange: string): boolean {
  const normalized = normalize(exchange);
  return list.some((entry) => normalize(entry) === "*" || normalize(entry) === normalized);
}

function includesPromptId(list: string[], promptId: string): boolean {
  const normalizedPromptId = normalize(promptId);
  return list.some((entry) => normalize(entry) === "*" || normalize(entry) === normalizedPromptId);
}

function normalizeStrategyKind(value: unknown): StrategyLicenseKind | null {
  if (value === "local" || value === "ai" || value === "composite") return value;
  return null;
}

function normalizeStringArray(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  const out = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return out;
}

function normalizeOptionalStringArray(value: unknown): string[] | null {
  const parsed = normalizeStringArray(value);
  if (!parsed || parsed.length === 0) return null;
  return parsed;
}

function normalizePlan(value: unknown): StrategyLicensePlan {
  if (value === "free" || value === "pro" || value === "enterprise") return value;
  return "pro";
}

function normalizeMoney(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
}

function normalizeMaxCompositeNodes(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function normalizeAllowedStrategyKinds(
  value: unknown,
  fallback: StrategyLicenseKind[]
): StrategyLicenseKind[] {
  if (!Array.isArray(value)) return [...fallback];
  const seen = new Set<StrategyLicenseKind>();
  const out: StrategyLicenseKind[] = [];
  for (const item of value) {
    const parsed = normalizeStrategyKind(item);
    if (!parsed || seen.has(parsed)) continue;
    seen.add(parsed);
    out.push(parsed);
  }
  return out.length > 0 ? out : [...fallback];
}

function matchStrategyId(allowlistEntry: string, kind: StrategyLicenseKind, id: string): boolean {
  const normalizedEntry = normalize(allowlistEntry);
  const normalizedId = normalize(id);
  if (!normalizedEntry) return false;
  if (normalizedEntry === "*") return true;
  if (normalizedEntry === normalizedId) return true;
  if (normalizedEntry === `${kind}:*`) return true;
  if (normalizedEntry === `${kind}:${normalizedId}`) return true;
  return false;
}

export function getDefaultStrategyPlan(
  raw: string | null | undefined = process.env.STRATEGY_LICENSE_DEFAULT_PLAN
): StrategyLicensePlan {
  const normalized = normalize(raw);
  if (normalized === "free" || normalized === "pro" || normalized === "enterprise") {
    return normalized;
  }
  return "pro";
}

export function getDefaultStrategyEntitlements(
  plan: StrategyLicensePlan
): {
  allowedStrategyKinds: StrategyLicenseKind[];
  maxCompositeNodes: number;
  aiAllowedModels: string[] | null;
} {
  const defaults = STRATEGY_PLAN_DEFAULTS[plan];
  return {
    allowedStrategyKinds: [...defaults.allowedStrategyKinds],
    maxCompositeNodes: defaults.maxCompositeNodes,
    aiAllowedModels: defaults.aiAllowedModels ? [...defaults.aiAllowedModels] : null
  };
}

export function isStrategyKindAllowed(
  entitlements: Pick<StrategyEntitlements, "allowedStrategyKinds">,
  kind: StrategyLicenseKind
): boolean {
  return entitlements.allowedStrategyKinds.includes(kind);
}

export function isStrategyIdAllowed(
  entitlements: Pick<StrategyEntitlements, "allowedStrategyIds">,
  kind: StrategyLicenseKind,
  strategyId: string | null | undefined
): boolean {
  const id = (strategyId ?? "").trim();
  if (!id) return true;
  if (entitlements.allowedStrategyIds === null) return true;
  return entitlements.allowedStrategyIds.some((entry) => matchStrategyId(entry, kind, id));
}

export function isAiModelAllowed(
  entitlements: Pick<StrategyEntitlements, "aiAllowedModels">,
  model: string | null | undefined
): boolean {
  const selectedModel = (model ?? "").trim();
  if (!selectedModel) return true;
  if (entitlements.aiAllowedModels === null) return true;
  if (entitlements.aiAllowedModels.length === 0) return false;
  return entitlements.aiAllowedModels.some((entry) => {
    const normalized = normalize(entry);
    return normalized === "*" || normalized === normalize(selectedModel);
  });
}

export function evaluateStrategyAccess(params: {
  entitlements: StrategyEntitlementsAccessInput;
  kind: StrategyLicenseKind;
  strategyId?: string | null;
  aiModel?: string | null;
  compositeNodes?: number | null;
}): StrategyAccessDecision {
  if (!isStrategyKindAllowed(params.entitlements, params.kind)) {
    return {
      allowed: false,
      reason: "kind_not_allowed",
      maxCompositeNodes: params.entitlements.maxCompositeNodes
    };
  }
  if (!isStrategyIdAllowed(params.entitlements, params.kind, params.strategyId)) {
    return {
      allowed: false,
      reason: "strategy_id_not_allowed",
      maxCompositeNodes: params.entitlements.maxCompositeNodes
    };
  }
  if (params.kind === "ai" && !isAiModelAllowed(params.entitlements, params.aiModel ?? null)) {
    return {
      allowed: false,
      reason: "ai_model_not_allowed",
      maxCompositeNodes: params.entitlements.maxCompositeNodes
    };
  }
  if (params.kind === "composite" && params.compositeNodes !== undefined && params.compositeNodes !== null) {
    if (params.compositeNodes > params.entitlements.maxCompositeNodes) {
      return {
        allowed: false,
        reason: "composite_nodes_exceeded",
        maxCompositeNodes: params.entitlements.maxCompositeNodes
      };
    }
  }
  return {
    allowed: true,
    reason: "ok",
    maxCompositeNodes: params.entitlements.maxCompositeNodes
  };
}

function getStrategyEntitlementsCacheTtlSeconds(): number {
  const ttl = Number(process.env.STRATEGY_LICENSE_CACHE_TTL_SECONDS ?? "120");
  return Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 120;
}

function buildPlanDefaultStrategyEntitlements(
  workspaceId: string,
  plan: StrategyLicensePlan
): StrategyEntitlements {
  const defaults = getDefaultStrategyEntitlements(plan);
  return {
    workspaceId,
    plan,
    allowedStrategyKinds: defaults.allowedStrategyKinds,
    allowedStrategyIds: null,
    maxCompositeNodes: defaults.maxCompositeNodes,
    aiAllowedModels: defaults.aiAllowedModels,
    aiMonthlyBudgetUsd: null,
    source: "plan_default"
  };
}

function parseStrategyEntitlementsRow(
  workspaceId: string,
  row: any
): StrategyEntitlements {
  const plan = normalizePlan(row?.plan);
  const defaults = getDefaultStrategyEntitlements(plan);
  const allowedStrategyKinds = normalizeAllowedStrategyKinds(
    row?.allowedStrategyKinds,
    defaults.allowedStrategyKinds
  );
  const allowedStrategyIds = normalizeOptionalStringArray(row?.allowedStrategyIds);
  const aiAllowedModels = normalizeOptionalStringArray(row?.aiAllowedModels);
  return {
    workspaceId,
    plan,
    allowedStrategyKinds,
    allowedStrategyIds,
    maxCompositeNodes: normalizeMaxCompositeNodes(
      row?.maxCompositeNodes,
      defaults.maxCompositeNodes
    ),
    aiAllowedModels,
    aiMonthlyBudgetUsd: normalizeMoney(row?.aiMonthlyBudgetUsd),
    source: "db"
  };
}

export async function resolveStrategyEntitlementsForWorkspace(params: {
  workspaceId: string;
  deps?: {
    fetchByWorkspaceId?: (workspaceId: string) => Promise<any | null>;
  };
}): Promise<StrategyEntitlements> {
  const workspaceId = params.workspaceId.trim();
  const planDefault = getDefaultStrategyPlan();
  if (!workspaceId) {
    return buildPlanDefaultStrategyEntitlements("unknown", planDefault);
  }

  const now = Date.now();
  const cached = strategyEntitlementsCache.get(workspaceId);
  if (cached && cached.expiresAt > now) {
    return cached.entitlements;
  }

  let row: any = null;
  if (params.deps?.fetchByWorkspaceId) {
    row = await params.deps.fetchByWorkspaceId(workspaceId);
  } else if (
    db.licenseEntitlement
    && typeof db.licenseEntitlement.findUnique === "function"
  ) {
    row = await db.licenseEntitlement.findUnique({
      where: { workspaceId },
      select: {
        workspaceId: true,
        plan: true,
        allowedStrategyKinds: true,
        allowedStrategyIds: true,
        maxCompositeNodes: true,
        aiAllowedModels: true,
        aiMonthlyBudgetUsd: true
      }
    });
  }

  const entitlements = row
    ? parseStrategyEntitlementsRow(workspaceId, row)
    : buildPlanDefaultStrategyEntitlements(workspaceId, planDefault);
  strategyEntitlementsCache.set(workspaceId, {
    entitlements,
    expiresAt: now + getStrategyEntitlementsCacheTtlSeconds() * 1000
  });
  return entitlements;
}

export function isLicenseEnforcementEnabled(raw: string | null | undefined = process.env.LICENSE_ENFORCEMENT): boolean {
  const normalized = normalize(raw);
  return normalized === "" || normalized === "on" || normalized === "true" || normalized === "1";
}

export function isLicenseStubEnabled(raw: string | null | undefined = process.env.LICENSE_STUB_ENABLED): boolean {
  const normalized = normalize(raw);
  if (normalized === "") return process.env.NODE_ENV !== "production";
  return normalized === "on" || normalized === "true" || normalized === "1";
}

export function getAiPromptLicenseMode(
  raw: string | null | undefined = process.env.AI_PROMPT_LICENSE_MODE
): AiPromptLicenseMode {
  const normalized = normalize(raw);
  if (normalized === "warn") return "warn";
  if (normalized === "enforce") return "enforce";
  return "off";
}

export function getAiPromptAllowedPublicIds(
  raw: string | null | undefined = process.env.AI_PROMPT_ALLOWED_PUBLIC_IDS
): string[] {
  const values = (raw ?? "*")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : ["*"];
}

export function evaluateAiPromptAccess(params: {
  userId: string;
  selectedPromptId: string | null;
}): AiPromptAccessDecision {
  void params.userId;
  const mode = getAiPromptLicenseMode();
  const promptId = normalize(params.selectedPromptId);
  if (!promptId) {
    return {
      allowed: true,
      reason: "no_prompt_selected",
      mode,
      wouldBlock: false
    };
  }

  const allowedList = getAiPromptAllowedPublicIds();
  const matches = includesPromptId(allowedList, promptId);
  if (mode === "off") {
    return {
      allowed: true,
      reason: "enforcement_off",
      mode,
      wouldBlock: !matches
    };
  }
  if (matches) {
    return {
      allowed: true,
      reason: "ok",
      mode,
      wouldBlock: false
    };
  }
  if (mode === "warn") {
    return {
      allowed: true,
      reason: "prompt_not_allowed",
      mode,
      wouldBlock: true
    };
  }
  return {
    allowed: false,
    reason: "prompt_not_allowed",
    mode,
    wouldBlock: true
  };
}

export function getLicenseCacheTtlSeconds(): number {
  const ttl = Number(process.env.LICENSE_CACHE_TTL_SECONDS ?? "600");
  return Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 600;
}

function getLicenseServerBaseUrl(): string {
  const configured = process.env.LICENSE_SERVER_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const apiPort = Number(process.env.API_PORT ?? "4000");
  return `http://127.0.0.1:${apiPort}/license-server-stub`;
}

export function getStubEntitlements(): Entitlements {
  const maxRunningBots = Number(process.env.LICENSE_STUB_MAX_RUNNING_BOTS ?? "3");
  const maxBotsTotal = Number(process.env.LICENSE_STUB_MAX_BOTS_TOTAL ?? "10");
  const allowedExchanges = (process.env.LICENSE_STUB_ALLOWED_EXCHANGES ?? "mexc,binance")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    maxRunningBots: Number.isFinite(maxRunningBots) ? Math.max(0, Math.floor(maxRunningBots)) : 3,
    maxBotsTotal: Number.isFinite(maxBotsTotal) ? Math.max(0, Math.floor(maxBotsTotal)) : 10,
    allowedExchanges: allowedExchanges.length > 0 ? allowedExchanges : ["*"]
  };
}

export async function fetchEntitlements(userId: string): Promise<Entitlements> {
  const cacheHit = cache.get(userId);
  const now = Date.now();
  if (cacheHit && cacheHit.expiresAt > now) {
    return cacheHit.entitlements;
  }

  const base = getLicenseServerBaseUrl();
  const url = `${base}/entitlements?userId=${encodeURIComponent(userId)}`;
  let response: Response;
  try {
    response = await fetch(url, { method: "GET" });
  } catch {
    throw new Error("license_server_unreachable");
  }
  if (!response.ok) {
    throw new Error("license_server_unreachable");
  }

  const parsed = entitlementsSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("license_server_unreachable");
  }

  const ttlMs = getLicenseCacheTtlSeconds() * 1000;
  cache.set(userId, {
    entitlements: parsed.data,
    expiresAt: now + ttlMs
  });
  return parsed.data;
}

export async function enforceBotStartLicense(params: {
  userId: string;
  exchange: string;
  totalBots: number;
  runningBots: number;
  isAlreadyRunning: boolean;
}): Promise<LicenseDecision> {
  if (!isLicenseEnforcementEnabled()) {
    return { allowed: true, reason: "enforcement_off" };
  }

  let entitlements: Entitlements;
  try {
    entitlements = await fetchEntitlements(params.userId);
  } catch {
    return { allowed: false, reason: "license_server_unreachable" };
  }

  if (params.totalBots > entitlements.maxBotsTotal) {
    return { allowed: false, reason: "max_bots_total_exceeded" };
  }

  if (!params.isAlreadyRunning && params.runningBots >= entitlements.maxRunningBots) {
    return { allowed: false, reason: "max_running_bots_exceeded" };
  }

  if (!includesExchange(entitlements.allowedExchanges, params.exchange)) {
    return { allowed: false, reason: "exchange_not_allowed" };
  }

  return { allowed: true, reason: "ok" };
}

export function resetLicenseCache() {
  cache.clear();
  strategyEntitlementsCache.clear();
}

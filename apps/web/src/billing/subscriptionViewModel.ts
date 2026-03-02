export type BillingPackageKind = "plan" | "ai_topup" | "entitlement_topup";

export type BillingPackage = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: BillingPackageKind;
  isActive: boolean;
  sortOrder: number;
  priceCents: number;
  currency: string;
  billingMonths: number;
  plan: "free" | "pro" | null;
  maxRunningBots: number | null;
  maxBotsTotal: number | null;
  maxRunningPredictionsAi: number | null;
  maxPredictionsAiTotal: number | null;
  maxRunningPredictionsComposite: number | null;
  maxPredictionsCompositeTotal: number | null;
  allowedExchanges: string[];
  monthlyAiTokens: string;
  topupAiTokens: string;
  topupRunningBots: number | null;
  topupBotsTotal: number | null;
  topupRunningPredictionsAi: number | null;
  topupPredictionsAiTotal: number | null;
  topupRunningPredictionsComposite: number | null;
  topupPredictionsCompositeTotal: number | null;
};

export type BillingOrder = {
  id: string;
  merchantOrderId: string;
  status: "pending" | "paid" | "failed" | "expired";
  amountCents: number;
  currency: string;
  payUrl: string | null;
  paymentStatusRaw: string | null;
  paidAt: string | null;
  createdAt: string | null;
  package: {
    id: string;
    code: string;
    name: string;
    kind: BillingPackageKind;
  } | null;
  items: Array<{
    id: string;
    quantity: number;
    unitPriceCents: number;
    lineAmountCents: number;
    currency: string;
    kind: BillingPackageKind;
    package: {
      id: string;
      code: string;
      name: string;
      kind: BillingPackageKind;
    } | null;
  }>;
};

export type SubscriptionPayload = {
  billingEnabled: boolean;
  plan: "free" | "pro";
  status: "active" | "inactive";
  proValidUntil: string | null;
  fallbackReason?: string | null;
  limits: {
    maxRunningBots: number;
    maxBotsTotal: number;
    allowedExchanges: string[];
    bots: {
      maxRunning: number;
      maxTotal: number;
    };
    predictions: {
      local: {
        maxRunning: number | null;
        maxTotal: number | null;
      };
      ai: {
        maxRunning: number | null;
        maxTotal: number | null;
      };
      composite: {
        maxRunning: number | null;
        maxTotal: number | null;
      };
    };
  };
  usage: {
    totalBots: number;
    runningBots: number;
    bots: {
      running: number;
      total: number;
    };
    predictions: {
      local: {
        running: number;
        total: number;
      };
      ai: {
        running: number;
        total: number;
      };
      composite: {
        running: number;
        total: number;
      };
    };
  };
  ai: {
    tokenBalance: string;
    tokenUsedLifetime: string;
    monthlyIncluded: string;
    billingEnabled: boolean;
  };
  packages: BillingPackage[];
  orders: BillingOrder[];
};

export type AuthMePayload = {
  user?: {
    id: string;
    email: string;
  };
  id?: string;
  email?: string;
};

export type ServerInfoPayload = {
  serverIpAddress: string | null;
};

export type LicensePageModel = {
  plan: "free" | "pro";
  status: "active" | "inactive";
  proValidUntil: string | null;
  fallbackReason: string | null;
  account: {
    email: string | null;
    userId: string | null;
  };
  limits: {
    bots: {
      running: number;
      total: number;
      maxRunning: number;
      maxTotal: number;
    };
    predictionsAi: {
      running: number;
      total: number;
      maxRunning: number | null;
      maxTotal: number | null;
    };
    predictionsComposite: {
      running: number;
      total: number;
      maxRunning: number | null;
      maxTotal: number | null;
    };
    exchanges: string[];
  };
  ai: {
    balance: string;
    monthlyIncluded: string;
    usedLifetime: string;
  };
  features: {
    proPlan: boolean;
    aiBillingEnabled: boolean;
    aiTopupAvailable: boolean;
    capacityTopupAvailable: boolean;
    fallbackMode: boolean;
  };
  instance: {
    serverIpAddress: string | null;
  };
  orders: BillingOrder[];
};

export type OrderPageModel = {
  planPackages: BillingPackage[];
  capacityAddonPackages: BillingPackage[];
  aiTopupPackages: BillingPackage[];
  defaultPlanId: string | null;
  hasPlans: boolean;
  hasCapacityAddons: boolean;
  hasAiTopups: boolean;
};

export function centsToCurrency(cents: number, currency: string): string {
  const value = Number(cents) / 100;
  return `${value.toFixed(2)} ${currency}`;
}

function sortPackages(a: BillingPackage, b: BillingPackage): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.name.localeCompare(b.name);
}

export function buildOrderPageModel(payload: SubscriptionPayload | null): OrderPageModel {
  const all = Array.isArray(payload?.packages) ? payload?.packages : [];
  const planPackages = all.filter((pkg) => pkg.kind === "plan").sort(sortPackages);
  const capacityAddonPackages = all
    .filter((pkg) => pkg.kind === "entitlement_topup")
    .sort(sortPackages);
  const aiTopupPackages = all
    .filter((pkg) => pkg.kind === "ai_topup")
    .sort(sortPackages);
  return {
    planPackages,
    capacityAddonPackages,
    aiTopupPackages,
    defaultPlanId: planPackages[0]?.id ?? null,
    hasPlans: planPackages.length > 0,
    hasCapacityAddons: capacityAddonPackages.length > 0,
    hasAiTopups: aiTopupPackages.length > 0
  };
}

export function buildLicensePageModel(
  payload: SubscriptionPayload | null,
  me: AuthMePayload | null,
  serverInfo: ServerInfoPayload | null
): LicensePageModel | null {
  if (!payload) return null;
  const aiTopupAvailable = payload.packages.some((pkg) => pkg.kind === "ai_topup");
  const capacityTopupAvailable = payload.packages.some((pkg) => pkg.kind === "entitlement_topup");
  return {
    plan: payload.plan,
    status: payload.status,
    proValidUntil: payload.proValidUntil,
    fallbackReason:
      typeof payload.fallbackReason === "string" && payload.fallbackReason.trim()
        ? payload.fallbackReason
        : null,
    account: {
      email:
        typeof me?.email === "string"
          ? me.email
          : typeof me?.user?.email === "string"
            ? me.user.email
            : null,
      userId:
        typeof me?.id === "string"
          ? me.id
          : typeof me?.user?.id === "string"
            ? me.user.id
            : null
    },
    limits: {
      bots: {
        running: payload.usage.bots.running,
        total: payload.usage.bots.total,
        maxRunning: payload.limits.bots.maxRunning,
        maxTotal: payload.limits.bots.maxTotal
      },
      predictionsAi: {
        running: payload.usage.predictions.ai.running,
        total: payload.usage.predictions.ai.total,
        maxRunning: payload.limits.predictions.ai.maxRunning,
        maxTotal: payload.limits.predictions.ai.maxTotal
      },
      predictionsComposite: {
        running: payload.usage.predictions.composite.running,
        total: payload.usage.predictions.composite.total,
        maxRunning: payload.limits.predictions.composite.maxRunning,
        maxTotal: payload.limits.predictions.composite.maxTotal
      },
      exchanges: payload.limits.allowedExchanges
    },
    ai: {
      balance: payload.ai.tokenBalance,
      monthlyIncluded: payload.ai.monthlyIncluded,
      usedLifetime: payload.ai.tokenUsedLifetime
    },
    features: {
      proPlan: payload.plan === "pro",
      aiBillingEnabled: Boolean(payload.ai.billingEnabled),
      aiTopupAvailable,
      capacityTopupAvailable,
      fallbackMode: Boolean(payload.fallbackReason)
    },
    instance: {
      serverIpAddress:
        typeof serverInfo?.serverIpAddress === "string" && serverInfo.serverIpAddress.trim()
          ? serverInfo.serverIpAddress.trim()
          : null
    },
    orders: payload.orders
  };
}

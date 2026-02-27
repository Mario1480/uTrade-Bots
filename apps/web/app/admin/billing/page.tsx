"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

type BillingPackage = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: "plan" | "ai_topup";
  isActive: boolean;
  sortOrder: number;
  currency: string;
  priceCents: number;
  billingMonths: number;
  plan: "free" | "pro" | null;
  maxRunningBots: number | null;
  maxBotsTotal: number | null;
  allowedExchanges: string[];
  monthlyAiTokens: string;
  topupAiTokens: string;
};

type BillingPackagesResponse = {
  items: BillingPackage[];
};

type BillingFeatureFlagsResponse = {
  billingEnabled: boolean;
  billingWebhookEnabled: boolean;
  aiTokenBillingEnabled: boolean;
  source: "db" | "default";
  updatedAt: string | null;
  defaults: {
    billingEnabled: boolean;
    billingWebhookEnabled: boolean;
    aiTokenBillingEnabled: boolean;
  };
};

type PackageDraft = {
  code: string;
  name: string;
  description: string;
  kind: "plan" | "ai_topup";
  isActive: boolean;
  sortOrder: number;
  currency: string;
  priceCents: number;
  billingMonths: number;
  plan: "free" | "pro" | "";
  maxRunningBots: number | "";
  maxBotsTotal: number | "";
  allowedExchanges: string;
  monthlyAiTokens: number;
  topupAiTokens: number;
};

function toDraft(pkg: BillingPackage): PackageDraft {
  return {
    code: pkg.code,
    name: pkg.name,
    description: pkg.description ?? "",
    kind: pkg.kind,
    isActive: pkg.isActive,
    sortOrder: pkg.sortOrder,
    currency: pkg.currency,
    priceCents: pkg.priceCents,
    billingMonths: pkg.billingMonths,
    plan: pkg.plan ?? "",
    maxRunningBots: pkg.maxRunningBots ?? "",
    maxBotsTotal: pkg.maxBotsTotal ?? "",
    allowedExchanges: (pkg.allowedExchanges ?? ["*"]).join(","),
    monthlyAiTokens: Number(pkg.monthlyAiTokens ?? "0"),
    topupAiTokens: Number(pkg.topupAiTokens ?? "0")
  };
}

function emptyDraft(): PackageDraft {
  return {
    code: "",
    name: "",
    description: "",
    kind: "plan",
    isActive: true,
    sortOrder: 0,
    currency: "USD",
    priceCents: 0,
    billingMonths: 1,
    plan: "pro",
    maxRunningBots: 3,
    maxBotsTotal: 10,
    allowedExchanges: "*",
    monthlyAiTokens: 1000000,
    topupAiTokens: 0
  };
}

function buildPayload(draft: PackageDraft) {
  return {
    code: draft.code.trim(),
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    kind: draft.kind,
    isActive: draft.isActive,
    sortOrder: Number(draft.sortOrder) || 0,
    currency: draft.currency.trim() || "USD",
    priceCents: Number(draft.priceCents) || 0,
    billingMonths: Number(draft.billingMonths) || 1,
    plan: draft.plan ? draft.plan : null,
    maxRunningBots: draft.maxRunningBots === "" ? null : Number(draft.maxRunningBots),
    maxBotsTotal: draft.maxBotsTotal === "" ? null : Number(draft.maxBotsTotal),
    allowedExchanges: draft.allowedExchanges.split(",").map((item) => item.trim()).filter(Boolean),
    monthlyAiTokens: Number(draft.monthlyAiTokens) || 0,
    topupAiTokens: Number(draft.topupAiTokens) || 0,
    meta: null
  };
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as { message?: unknown }).message ?? e);
  return String(e);
}

export default function AdminBillingPage() {
  const t = useTranslations("admin.billing");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [items, setItems] = useState<BillingPackage[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PackageDraft>>({});
  const [createDraft, setCreateDraft] = useState<PackageDraft>(emptyDraft());
  const [adjustUserId, setAdjustUserId] = useState("");
  const [adjustDelta, setAdjustDelta] = useState("0");
  const [adjustNote, setAdjustNote] = useState("");
  const [featureFlags, setFeatureFlags] = useState<BillingFeatureFlagsResponse | null>(null);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [billingWebhookEnabled, setBillingWebhookEnabled] = useState(true);
  const [aiTokenBillingEnabled, setAiTokenBillingEnabled] = useState(true);

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      const [payload, flags] = await Promise.all([
        apiGet<BillingPackagesResponse>("/admin/billing/packages"),
        apiGet<BillingFeatureFlagsResponse>("/admin/settings/billing")
      ]);
      setItems(payload.items ?? []);
      setFeatureFlags(flags);
      setBillingEnabled(Boolean(flags.billingEnabled));
      setBillingWebhookEnabled(Boolean(flags.billingWebhookEnabled));
      setAiTokenBillingEnabled(Boolean(flags.aiTokenBillingEnabled));
      const nextDrafts: Record<string, PackageDraft> = {};
      for (const item of payload.items ?? []) {
        nextDrafts[item.id] = toDraft(item);
      }
      setDrafts(nextDrafts);
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createPackage() {
    setSavingId("new");
    setMsg(null);
    try {
      await apiPost("/admin/billing/packages", buildPayload(createDraft));
      setCreateDraft(emptyDraft());
      await load();
      setMsg(t("saved"));
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setSavingId(null);
    }
  }

  async function savePackage(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    setMsg(null);
    try {
      await apiPut(`/admin/billing/packages/${id}`, buildPayload(draft));
      await load();
      setMsg(t("saved"));
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setSavingId(null);
    }
  }

  async function deletePackage(id: string) {
    if (!confirm(t("confirmDelete"))) return;
    setSavingId(id);
    setMsg(null);
    try {
      await apiDelete(`/admin/billing/packages/${id}`);
      await load();
      setMsg(t("deleted"));
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setSavingId(null);
    }
  }

  async function adjustTokens() {
    const userId = adjustUserId.trim();
    if (!userId) return;
    setSavingId("adjust");
    setMsg(null);
    try {
      await apiPost(`/admin/billing/users/${encodeURIComponent(userId)}/tokens/adjust`, {
        deltaTokens: Number(adjustDelta) || 0,
        note: adjustNote.trim() || undefined
      });
      setMsg(t("adjusted"));
      setAdjustDelta("0");
      setAdjustNote("");
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setSavingId(null);
    }
  }

  async function saveFeatureFlags() {
    setSavingId("flags");
    setMsg(null);
    try {
      const saved = await apiPut<BillingFeatureFlagsResponse>("/admin/settings/billing", {
        billingEnabled,
        billingWebhookEnabled,
        aiTokenBillingEnabled
      });
      setFeatureFlags(saved);
      setBillingEnabled(Boolean(saved.billingEnabled));
      setBillingWebhookEnabled(Boolean(saved.billingWebhookEnabled));
      setAiTokenBillingEnabled(Boolean(saved.aiTokenBillingEnabled));
      setMsg(t("featureFlags.saved"));
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="settingsWrap">
      <div className="adminTopActions">
        <Link href={withLocalePath("/admin", locale)} className="btn">← {tCommon("backToAdmin")}</Link>
        <Link href={withLocalePath("/settings", locale)} className="btn">← {tCommon("backToSettings")}</Link>
      </div>

      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <div className="settingsMutedText" style={{ marginBottom: 12 }}>{t("description")}</div>

      {msg ? <div className="settingsMutedText" style={{ marginBottom: 10 }}>{msg}</div> : null}

      <section className="card settingsSection" style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{t("featureFlags.title")}</div>
        <div className="settingsMutedText" style={{ marginBottom: 8 }}>{t("featureFlags.description")}</div>
        <div className="settingsMutedText" style={{ marginBottom: 8, fontSize: 12 }}>
          {t("featureFlags.source")}: {featureFlags?.source ?? "default"} · {t("featureFlags.updatedAt")}:{" "}
          {featureFlags?.updatedAt ? new Date(featureFlags.updatedAt).toLocaleString() : t("featureFlags.never")}
        </div>
        <div style={{ display: "grid", gap: 8, maxWidth: 620, marginBottom: 10 }}>
          <FormField label={t("featureFlags.billingEnabled.label")} hint={t("featureFlags.billingEnabled.hint")}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={billingEnabled} onChange={(e) => setBillingEnabled(e.target.checked)} />
              {t("featureFlags.enabledValue")}
            </label>
          </FormField>
          <FormField label={t("featureFlags.billingWebhookEnabled.label")} hint={t("featureFlags.billingWebhookEnabled.hint")}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={billingWebhookEnabled} onChange={(e) => setBillingWebhookEnabled(e.target.checked)} />
              {t("featureFlags.enabledValue")}
            </label>
          </FormField>
          <FormField label={t("featureFlags.aiTokenBillingEnabled.label")} hint={t("featureFlags.aiTokenBillingEnabled.hint")}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={aiTokenBillingEnabled} onChange={(e) => setAiTokenBillingEnabled(e.target.checked)} />
              {t("featureFlags.enabledValue")}
            </label>
          </FormField>
        </div>
        <button className="btn btnPrimary" onClick={saveFeatureFlags} disabled={savingId === "flags"}>
          {savingId === "flags" ? tCommon("saving") : t("featureFlags.save")}
        </button>
      </section>

      <section className="card settingsSection" style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{t("createTitle")}</div>
        <div className="settingsMutedText" style={{ marginBottom: 8 }}>{t("createHelp")}</div>
        <PackageForm draft={createDraft} setDraft={setCreateDraft} />
        <button className="btn btnPrimary" onClick={createPackage} disabled={savingId === "new"}>
          {savingId === "new" ? tCommon("saving") : t("create")}
        </button>
      </section>

      <section className="card settingsSection" style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{t("tokenAdjustTitle")}</div>
        <div className="settingsMutedText" style={{ marginBottom: 8 }}>{t("tokenAdjustHelp")}</div>
        <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
          <FormField label={t("userId")} hint={t("userIdHint")}>
            <input
              className="input"
              placeholder={t("userIdPlaceholder")}
              value={adjustUserId}
              onChange={(e) => setAdjustUserId(e.target.value)}
            />
          </FormField>
          <FormField label={t("deltaTokens")} hint={t("deltaTokensHint")}>
            <input
              className="input"
              placeholder="0"
              value={adjustDelta}
              onChange={(e) => setAdjustDelta(e.target.value)}
            />
          </FormField>
          <FormField label={t("note")} hint={t("noteHint")}>
            <input
              className="input"
              placeholder={t("notePlaceholder")}
              value={adjustNote}
              onChange={(e) => setAdjustNote(e.target.value)}
            />
          </FormField>
          <button className="btn btnPrimary" onClick={adjustTokens} disabled={savingId === "adjust"}>
            {savingId === "adjust" ? tCommon("saving") : t("adjust")}
          </button>
        </div>
      </section>

      <section className="card settingsSection">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>{t("listTitle")}</div>
          <button className="btn" onClick={load} disabled={loading}>{t("refresh")}</button>
        </div>

        {loading ? (
          <div className="settingsMutedText">{tCommon("loading")}</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {items.map((item) => (
              <div className="settingsPanel" key={item.id} style={{ padding: 12 }}>
                <div style={{ marginBottom: 8, fontWeight: 700 }}>{item.name} ({item.code})</div>
                <PackageForm
                  draft={drafts[item.id]}
                  setDraft={(next) => setDrafts((prev) => ({ ...prev, [item.id]: next }))}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn btnPrimary" onClick={() => savePackage(item.id)} disabled={savingId === item.id}>
                    {savingId === item.id ? tCommon("saving") : t("save")}
                  </button>
                  <button className="btn btnStop" onClick={() => deletePackage(item.id)} disabled={savingId === item.id}>
                    {t("delete")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function FormField({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>{label}</div>
      {children}
      {hint ? <div className="settingsMutedText" style={{ fontSize: 12 }}>{hint}</div> : null}
    </div>
  );
}

function PackageForm({
  draft,
  setDraft
}: {
  draft: PackageDraft;
  setDraft: (next: PackageDraft) => void;
}) {
  const t = useTranslations("admin.billing");

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8, marginBottom: 8 }}>
      <FormField label={t("fields.code.label")} hint={t("fields.code.hint")}>
        <input className="input" value={draft.code} placeholder="pro_monthly" onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
      </FormField>
      <FormField label={t("fields.name.label")} hint={t("fields.name.hint")}>
        <input className="input" value={draft.name} placeholder={t("fields.name.placeholder")} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </FormField>
      <FormField label={t("fields.description.label")} hint={t("fields.description.hint")}>
        <input className="input" value={draft.description} placeholder={t("fields.description.placeholder")} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </FormField>
      <FormField label={t("fields.kind.label")} hint={t("fields.kind.hint")}>
        <select className="input" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as "plan" | "ai_topup" })}>
          <option value="plan">{t("fields.kind.plan")}</option>
          <option value="ai_topup">{t("fields.kind.aiTopup")}</option>
        </select>
      </FormField>
      <FormField label={t("fields.plan.label")} hint={t("fields.plan.hint")}>
        <select className="input" value={draft.plan} onChange={(e) => setDraft({ ...draft, plan: e.target.value as "free" | "pro" | "" })}>
          <option value="">{t("fields.plan.none")}</option>
          <option value="free">{t("fields.plan.free")}</option>
          <option value="pro">{t("fields.plan.pro")}</option>
        </select>
      </FormField>
      <FormField label={t("fields.sortOrder.label")} hint={t("fields.sortOrder.hint")}>
        <input className="input" type="number" value={draft.sortOrder} placeholder="0" onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })} />
      </FormField>
      <FormField label={t("fields.currency.label")} hint={t("fields.currency.hint")}>
        <input className="input" value={draft.currency} placeholder="USD" onChange={(e) => setDraft({ ...draft, currency: e.target.value })} />
      </FormField>
      <FormField label={t("fields.priceCents.label")} hint={t("fields.priceCents.hint")}>
        <input className="input" type="number" value={draft.priceCents} placeholder="2900" onChange={(e) => setDraft({ ...draft, priceCents: Number(e.target.value) })} />
      </FormField>
      <FormField label={t("fields.billingMonths.label")} hint={t("fields.billingMonths.hint")}>
        <input className="input" type="number" value={draft.billingMonths} placeholder="1" onChange={(e) => setDraft({ ...draft, billingMonths: Number(e.target.value) })} />
      </FormField>
      <FormField label={t("fields.maxRunningBots.label")} hint={t("fields.maxRunningBots.hint")}>
        <input className="input" value={draft.maxRunningBots} placeholder="3" onChange={(e) => setDraft({ ...draft, maxRunningBots: e.target.value === "" ? "" : Number(e.target.value) })} />
      </FormField>
      <FormField label={t("fields.maxBotsTotal.label")} hint={t("fields.maxBotsTotal.hint")}>
        <input className="input" value={draft.maxBotsTotal} placeholder="10" onChange={(e) => setDraft({ ...draft, maxBotsTotal: e.target.value === "" ? "" : Number(e.target.value) })} />
      </FormField>
      <FormField label={t("fields.allowedExchanges.label")} hint={t("fields.allowedExchanges.hint")}>
        <input className="input" value={draft.allowedExchanges} placeholder="*" onChange={(e) => setDraft({ ...draft, allowedExchanges: e.target.value })} />
      </FormField>
      <FormField label={t("fields.monthlyAiTokens.label")} hint={t("fields.monthlyAiTokens.hint")}>
        <input className="input" type="number" value={draft.monthlyAiTokens} placeholder="1000000" onChange={(e) => setDraft({ ...draft, monthlyAiTokens: Number(e.target.value) })} />
      </FormField>
      <FormField label={t("fields.topupAiTokens.label")} hint={t("fields.topupAiTokens.hint")}>
        <input className="input" type="number" value={draft.topupAiTokens} placeholder="250000" onChange={(e) => setDraft({ ...draft, topupAiTokens: Number(e.target.value) })} />
      </FormField>
      <FormField label={t("fields.isActive.label")} hint={t("fields.isActive.hint")}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
          {t("fields.isActive.value")}
        </label>
      </FormField>
    </div>
  );
}

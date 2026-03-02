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
  kind: "plan" | "ai_topup" | "entitlement_topup";
  isActive: boolean;
  sortOrder: number;
  currency: string;
  priceCents: number;
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
  kind: "plan" | "ai_topup" | "entitlement_topup";
  isActive: boolean;
  sortOrder: number;
  currency: string;
  priceCents: number;
  billingMonths: number;
  plan: "free" | "pro" | "";
  maxRunningBots: number | "";
  maxBotsTotal: number | "";
  maxRunningPredictionsAi: number | "";
  maxPredictionsAiTotal: number | "";
  maxRunningPredictionsComposite: number | "";
  maxPredictionsCompositeTotal: number | "";
  allowedExchanges: string;
  monthlyAiTokens: number;
  topupAiTokens: number;
  topupRunningBots: number | "";
  topupBotsTotal: number | "";
  topupRunningPredictionsAi: number | "";
  topupPredictionsAiTotal: number | "";
  topupRunningPredictionsComposite: number | "";
  topupPredictionsCompositeTotal: number | "";
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
    maxRunningPredictionsAi: pkg.maxRunningPredictionsAi ?? "",
    maxPredictionsAiTotal: pkg.maxPredictionsAiTotal ?? "",
    maxRunningPredictionsComposite: pkg.maxRunningPredictionsComposite ?? "",
    maxPredictionsCompositeTotal: pkg.maxPredictionsCompositeTotal ?? "",
    allowedExchanges: (pkg.allowedExchanges ?? ["*"]).join(","),
    monthlyAiTokens: Number(pkg.monthlyAiTokens ?? "0"),
    topupAiTokens: Number(pkg.topupAiTokens ?? "0"),
    topupRunningBots: pkg.topupRunningBots ?? "",
    topupBotsTotal: pkg.topupBotsTotal ?? "",
    topupRunningPredictionsAi: pkg.topupRunningPredictionsAi ?? "",
    topupPredictionsAiTotal: pkg.topupPredictionsAiTotal ?? "",
    topupRunningPredictionsComposite: pkg.topupRunningPredictionsComposite ?? "",
    topupPredictionsCompositeTotal: pkg.topupPredictionsCompositeTotal ?? ""
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
    maxRunningPredictionsAi: 3,
    maxPredictionsAiTotal: 10,
    maxRunningPredictionsComposite: 2,
    maxPredictionsCompositeTotal: 6,
    allowedExchanges: "*",
    monthlyAiTokens: 1000000,
    topupAiTokens: 0,
    topupRunningBots: "",
    topupBotsTotal: "",
    topupRunningPredictionsAi: "",
    topupPredictionsAiTotal: "",
    topupRunningPredictionsComposite: "",
    topupPredictionsCompositeTotal: ""
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
    maxRunningPredictionsAi:
      draft.maxRunningPredictionsAi === "" ? null : Number(draft.maxRunningPredictionsAi),
    maxPredictionsAiTotal:
      draft.maxPredictionsAiTotal === "" ? null : Number(draft.maxPredictionsAiTotal),
    maxRunningPredictionsComposite:
      draft.maxRunningPredictionsComposite === "" ? null : Number(draft.maxRunningPredictionsComposite),
    maxPredictionsCompositeTotal:
      draft.maxPredictionsCompositeTotal === "" ? null : Number(draft.maxPredictionsCompositeTotal),
    allowedExchanges: draft.allowedExchanges.split(",").map((item) => item.trim()).filter(Boolean),
    monthlyAiTokens: Number(draft.monthlyAiTokens) || 0,
    topupAiTokens: Number(draft.topupAiTokens) || 0,
    topupRunningBots: draft.topupRunningBots === "" ? null : Number(draft.topupRunningBots),
    topupBotsTotal: draft.topupBotsTotal === "" ? null : Number(draft.topupBotsTotal),
    topupRunningPredictionsAi:
      draft.topupRunningPredictionsAi === "" ? null : Number(draft.topupRunningPredictionsAi),
    topupPredictionsAiTotal:
      draft.topupPredictionsAiTotal === "" ? null : Number(draft.topupPredictionsAiTotal),
    topupRunningPredictionsComposite:
      draft.topupRunningPredictionsComposite === ""
        ? null
        : Number(draft.topupRunningPredictionsComposite),
    topupPredictionsCompositeTotal:
      draft.topupPredictionsCompositeTotal === ""
        ? null
        : Number(draft.topupPredictionsCompositeTotal),
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
  const [adjustUserLookup, setAdjustUserLookup] = useState("");
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
    const userLookup = adjustUserLookup.trim();
    if (!userLookup) return;
    setSavingId("adjust");
    setMsg(null);
    try {
      await apiPost(`/admin/billing/users/${encodeURIComponent(userLookup)}/tokens/adjust`, {
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
              value={adjustUserLookup}
              onChange={(e) => setAdjustUserLookup(e.target.value)}
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
        <select className="input" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as "plan" | "ai_topup" | "entitlement_topup" })}>
          <option value="plan">{t("fields.kind.plan")}</option>
          <option value="ai_topup">{t("fields.kind.aiTopup")}</option>
          <option value="entitlement_topup">{t("fields.kind.entitlementTopup")}</option>
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
      <FormField label={t("fields.maxRunningPredictionsAi.label")} hint={t("fields.maxRunningPredictionsAi.hint")}>
        <input className="input" value={draft.maxRunningPredictionsAi} placeholder="3" onChange={(e) => setDraft({ ...draft, maxRunningPredictionsAi: e.target.value === "" ? "" : Number(e.target.value) })} />
      </FormField>
      <FormField label={t("fields.maxPredictionsAiTotal.label")} hint={t("fields.maxPredictionsAiTotal.hint")}>
        <input className="input" value={draft.maxPredictionsAiTotal} placeholder="10" onChange={(e) => setDraft({ ...draft, maxPredictionsAiTotal: e.target.value === "" ? "" : Number(e.target.value) })} />
      </FormField>
      <FormField label={t("fields.maxRunningPredictionsComposite.label")} hint={t("fields.maxRunningPredictionsComposite.hint")}>
        <input className="input" value={draft.maxRunningPredictionsComposite} placeholder="2" onChange={(e) => setDraft({ ...draft, maxRunningPredictionsComposite: e.target.value === "" ? "" : Number(e.target.value) })} />
      </FormField>
      <FormField label={t("fields.maxPredictionsCompositeTotal.label")} hint={t("fields.maxPredictionsCompositeTotal.hint")}>
        <input className="input" value={draft.maxPredictionsCompositeTotal} placeholder="6" onChange={(e) => setDraft({ ...draft, maxPredictionsCompositeTotal: e.target.value === "" ? "" : Number(e.target.value) })} />
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
      <FormField label={t("fields.topupRunningBots.label")} hint={t("fields.topupRunningBots.hint")}>
        <input className="input" value={draft.topupRunningBots} placeholder="1" onChange={(e) => setDraft({ ...draft, topupRunningBots: e.target.value === "" ? "" : Number(e.target.value) })} />
      </FormField>
      <FormField label={t("fields.topupBotsTotal.label")} hint={t("fields.topupBotsTotal.hint")}>
        <input className="input" value={draft.topupBotsTotal} placeholder="2" onChange={(e) => setDraft({ ...draft, topupBotsTotal: e.target.value === "" ? "" : Number(e.target.value) })} />
      </FormField>
      <FormField label={t("fields.topupRunningPredictionsAi.label")} hint={t("fields.topupRunningPredictionsAi.hint")}>
        <input className="input" value={draft.topupRunningPredictionsAi} placeholder="1" onChange={(e) => setDraft({ ...draft, topupRunningPredictionsAi: e.target.value === "" ? "" : Number(e.target.value) })} />
      </FormField>
      <FormField label={t("fields.topupPredictionsAiTotal.label")} hint={t("fields.topupPredictionsAiTotal.hint")}>
        <input className="input" value={draft.topupPredictionsAiTotal} placeholder="3" onChange={(e) => setDraft({ ...draft, topupPredictionsAiTotal: e.target.value === "" ? "" : Number(e.target.value) })} />
      </FormField>
      <FormField label={t("fields.topupRunningPredictionsComposite.label")} hint={t("fields.topupRunningPredictionsComposite.hint")}>
        <input className="input" value={draft.topupRunningPredictionsComposite} placeholder="1" onChange={(e) => setDraft({ ...draft, topupRunningPredictionsComposite: e.target.value === "" ? "" : Number(e.target.value) })} />
      </FormField>
      <FormField label={t("fields.topupPredictionsCompositeTotal.label")} hint={t("fields.topupPredictionsCompositeTotal.hint")}>
        <input className="input" value={draft.topupPredictionsCompositeTotal} placeholder="2" onChange={(e) => setDraft({ ...draft, topupPredictionsCompositeTotal: e.target.value === "" ? "" : Number(e.target.value) })} />
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

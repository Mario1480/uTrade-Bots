"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { withLocalePath, type AppLocale } from "../../i18n/config";

const HELP_SECTION_KEYS = [
  { id: "getting-started", key: "gettingStarted", lines: 2 },
  { id: "exchange-keys", key: "exchangeKeys", lines: 3 },
  { id: "bot-settings", key: "botSettings", lines: 3 },
  { id: "price-support", key: "priceSupport", lines: 3 },
  { id: "price-follow", key: "priceFollow", lines: 3 },
  { id: "manual-trading", key: "manualTrading", lines: 3 },
  { id: "roles", key: "roles", lines: 3 },
  { id: "security", key: "security", lines: 4 },
  { id: "troubleshooting", key: "troubleshooting", lines: 3 }
] as const;

export default function HelpPage() {
  const t = useTranslations("help");
  const tNav = useTranslations("nav");
  const locale = useLocale() as AppLocale;
  const sections = HELP_SECTION_KEYS.map((section) => ({
    id: section.id,
    title: t(`sections.${section.key}.title`),
    body: Array.from({ length: section.lines }, (_, index) => t(`sections.${section.key}.line${index + 1}`))
  }));

  return (
    <div>
      <div className="dashboardHeader">
        <div>
          <h2 style={{ margin: 0 }}>{t("title")}</h2>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{t("subtitle")}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={withLocalePath("/", locale)} className="btn">← {tNav("dashboard")}</Link>
          <Link href={withLocalePath("/settings", locale)} className="btn">← {tNav("settings")}</Link>
        </div>
      </div>

      <section className="card" style={{ padding: 12, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>{t("quickLinks")}</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {sections.map((s) => (
            <a key={s.id} className="btn" href={`#${s.id}`}>
              {s.title}
            </a>
          ))}
        </div>
      </section>

      <section className="card" style={{ padding: 12 }}>
        <div style={{ display: "grid", gap: 10 }}>
          {sections.map((section) => (
            <details key={section.id} id={section.id} className="card" style={{ padding: 12 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>{section.title}</summary>
              <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                {section.body.map((line, idx) => (
                  <div key={idx} style={{ fontSize: 13, color: "var(--muted)" }}>
                    {line}
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="card" style={{ padding: 12, marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>{t("contactTitle")}</h3>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          {t("contactBody")}
        </div>
        <div style={{ marginTop: 8 }}>
          <a className="btn btnPrimary" href="mailto:support@uliquid.vip">
            support@uliquid.vip
          </a>
        </div>
      </section>
    </div>
  );
}

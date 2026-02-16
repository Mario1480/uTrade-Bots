"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

export default function BotSettingsPage() {
  const t = useTranslations("system.botsSettings");
  const params = useParams<{ id: string }>();
  const id = params.id;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <div className="card" style={{ padding: 14 }}>
        <p style={{ marginTop: 0 }}>
          {t("description")}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={`/bots/${id}`} className="btn">{t("backToBot")}</Link>
          <Link href="/" className="btn">{t("dashboard")}</Link>
        </div>
      </div>
    </div>
  );
}

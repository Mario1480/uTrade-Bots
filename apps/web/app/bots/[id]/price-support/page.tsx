"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

export default function PriceSupportPage() {
  const t = useTranslations("system.botsPriceSupport");
  const params = useParams<{ id: string }>();
  const id = params.id;

  return (
    <div className="botsPriceSupportPage">
      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <div className="card" style={{ padding: 14 }}>
        <p style={{ marginTop: 0 }}>
          {t("description")}
        </p>
        <Link href={`/bots/${id}`} className="btn">{t("backToBot")}</Link>
      </div>
    </div>
  );
}

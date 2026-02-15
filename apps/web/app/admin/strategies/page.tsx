import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

export default function AdminStrategiesIndexPage() {
  const t = useTranslations("admin.strategiesIndex");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;

  return (
    <div className="settingsWrap">
      <div className="adminTopActions">
        <Link href={withLocalePath("/admin", locale)} className="btn">← {tCommon("backToAdmin")}</Link>
      </div>

      <div className="adminPageIntro">
        <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
        <p className="settingsMutedText">{t("subtitle")}</p>
      </div>

      <section className="card settingsSection" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={withLocalePath("/admin/strategies/local", locale)} className="btn btnPrimary">{t("local")}</Link>
          <Link href={withLocalePath("/admin/strategies/ai", locale)} className="btn">{t("ai")}</Link>
          <Link href={withLocalePath("/admin/strategies/builder", locale)} className="btn">{t("builder")}</Link>
        </div>
      </section>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet } from "../../lib/api";
import { withLocalePath, type AppLocale } from "../../i18n/config";

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

type AdminLinkItem = {
  href: string;
  i18nKey: string;
  category: "Access" | "Integrations" | "Strategy";
};

const ADMIN_CATEGORIES: AdminLinkItem["category"][] = ["Access", "Integrations", "Strategy"];

function adminCategoryClassName(category: AdminLinkItem["category"]): string {
  if (category === "Access") return "adminLandingGroupAccess";
  if (category === "Integrations") return "adminLandingGroupIntegrations";
  return "adminLandingGroupStrategy";
}

const ADMIN_LINKS: AdminLinkItem[] = [
  {
    href: "/admin/access-section",
    i18nKey: "accessSection",
    category: "Access"
  },
  {
    href: "/admin/users",
    i18nKey: "users",
    category: "Access"
  },
  {
    href: "/admin/server-info",
    i18nKey: "serverInfo",
    category: "Access"
  },
  {
    href: "/admin/telegram",
    i18nKey: "telegram",
    category: "Integrations"
  },
  {
    href: "/admin/exchanges",
    i18nKey: "exchanges",
    category: "Integrations"
  },
  {
    href: "/admin/smtp",
    i18nKey: "smtp",
    category: "Integrations"
  },
  {
    href: "/admin/api-keys",
    i18nKey: "apiKeys",
    category: "Integrations"
  },
  {
    href: "/admin/indicator-settings",
    i18nKey: "indicatorSettings",
    category: "Strategy"
  },
  {
    href: "/admin/strategies/local",
    i18nKey: "localStrategies",
    category: "Strategy"
  },
  {
    href: "/admin/strategies/builder",
    i18nKey: "compositeBuilder",
    category: "Strategy"
  },
  {
    href: "/admin/strategies/ai",
    i18nKey: "aiStrategies",
    category: "Strategy"
  },
  {
    href: "/admin/strategies/ai-generator",
    i18nKey: "aiPromptGenerator",
    category: "Strategy"
  },
  {
    href: "/admin/prediction-refresh",
    i18nKey: "predictionRefresh",
    category: "Strategy"
  },
  {
    href: "/admin/prediction-defaults",
    i18nKey: "predictionDefaults",
    category: "Strategy"
  },
  {
    href: "/admin/ai-trace",
    i18nKey: "aiTrace",
    category: "Strategy"
  }
];

export default function AdminPage() {
  const tLanding = useTranslations("admin.landing");
  const tLinks = useTranslations("admin.links");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filteredLinks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return ADMIN_LINKS;
    return ADMIN_LINKS.filter((item) =>
      [
        tLinks(`${item.i18nKey}.title`),
        tLinks(`${item.i18nKey}.description`),
        tLanding(`categories.${item.category}`)
      ].some((value) =>
        String(value).toLowerCase().includes(needle)
      )
    );
  }, [query, tLanding, tLinks]);

  const groupedLinks = useMemo(
    () =>
      ADMIN_CATEGORIES
        .map((category) => ({
          category,
          items: filteredLinks.filter((item) => item.category === category)
        }))
        .filter((group) => group.items.length > 0),
    [filteredLinks]
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const me = await apiGet<any>("/auth/me");
        setIsSuperadmin(Boolean(me?.isSuperadmin || me?.hasAdminBackendAccess));
        if (!(me?.isSuperadmin || me?.hasAdminBackendAccess)) setError(tLanding("accessRequired"));
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) return <div className="settingsWrap">{tLanding("loading")}</div>;

  return (
    <div className="settingsWrap">
      <div className="adminTopActions">
        <Link href={withLocalePath("/settings", locale)} className="btn">
          ← {tCommon("backToSettings")}
        </Link>
        <Link href={withLocalePath("/", locale)} className="btn">
          ← {tCommon("backToDashboard")}
        </Link>
      </div>
      <h2 style={{ marginTop: 0 }}>{tLanding("title")}</h2>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
        {tLanding("subtitle")}
      </div>

      {error ? (
        <div className="card settingsSection settingsAlert settingsAlertError">
          {error}
        </div>
      ) : null}

      {isSuperadmin ? (
        <>
          <section className="card settingsSection">
            <div className="adminLandingToolbar">
              <div className="adminLandingMeta">
                {tLanding("sectionsCount", { filtered: filteredLinks.length, total: ADMIN_LINKS.length })}
              </div>
              <input
                className="input adminLandingSearch"
                placeholder={tLanding("searchPlaceholder")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </section>

          {filteredLinks.length === 0 ? (
            <section className="card settingsSection">
              <div className="settingsMutedText">{tLanding("noMatch")}</div>
            </section>
          ) : null}

          <div className="adminLandingGrouped">
            {groupedLinks.map((group) => (
              <section
                key={group.category}
                className={`card settingsSection adminLandingGroupCard ${adminCategoryClassName(group.category)}`}
              >
                <div className="settingsSectionHeader">
                  <h3 style={{ margin: 0 }}>{tLanding(`categories.${group.category}`)}</h3>
                  <div className="settingsSectionMeta">{tLanding("groupSectionCount", { count: group.items.length })}</div>
                </div>
                <div className="adminLandingGrid adminLandingGroupGrid">
                  {group.items.map((item) => (
                    <article key={item.href} className="card adminLandingCard">
                      <div className="adminLandingCardHeader">
                        <h3 style={{ margin: 0 }}>{tLinks(`${item.i18nKey}.title`)}</h3>
                      </div>
                      <div className="adminLandingDesc">
                        {tLinks(`${item.i18nKey}.description`)}
                      </div>
                      <div className="adminLandingActions">
                        <Link href={withLocalePath(item.href, locale)} className="btn btnPrimary">
                          {tCommon("openSection", { title: tLinks(`${item.i18nKey}.title`) })}
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import {
  extractLocaleFromPathname,
  withLocalePath,
  type AppLocale
} from "../../i18n/config";
import { apiGet } from "../../lib/api";
import {
  DEFAULT_ACCESS_SECTION_VISIBILITY,
  type AccessSectionVisibility
} from "../../src/access/accessSection";

type SidebarIconName =
  | "dashboard"
  | "manualTrading"
  | "bots"
  | "predictions"
  | "calendar"
  | "news"
  | "settings"
  | "help"
  | "overview"
  | "riskAlerts"
  | "marketContext"
  | "accounts";

type SidebarItem = {
  key: string;
  label: string;
  href: string;
  icon: SidebarIconName;
  active: boolean;
};

type SidebarSectionItem = {
  key: string;
  label: string;
  href: "#overview" | "#risk-alerts" | "#market-context" | "#accounts";
  icon: SidebarIconName;
};

type SidebarDashboardOverviewAccount = {
  bots?: {
    running?: number;
    error?: number;
  } | null;
};

type SidebarDashboardOverviewResponse = {
  accounts?: SidebarDashboardOverviewAccount[];
};

type SidebarSnapshot = {
  accounts: number;
  running: number;
  errors: number;
};

function SidebarGlyph({ icon }: { icon: SidebarIconName }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "appSidebarGlyph"
  };

  switch (icon) {
    case "dashboard":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="8" height="8" rx="1.5" />
          <rect x="13" y="3" width="8" height="5" rx="1.5" />
          <rect x="13" y="10" width="8" height="11" rx="1.5" />
          <rect x="3" y="13" width="8" height="8" rx="1.5" />
        </svg>
      );
    case "manualTrading":
      return (
        <svg {...common}>
          <path d="M4 16l5-5 4 3 7-7" />
          <path d="M20 10V6h-4" />
          <path d="M4 20h16" />
        </svg>
      );
    case "bots":
      return (
        <svg {...common}>
          <rect x="5" y="8" width="14" height="11" rx="2" />
          <path d="M9 8V5h6v3" />
          <circle cx="10" cy="13" r="1" />
          <circle cx="14" cy="13" r="1" />
          <path d="M8 17h8" />
        </svg>
      );
    case "predictions":
      return (
        <svg {...common}>
          <path d="M4 19V5" />
          <path d="M4 19h16" />
          <path d="M7 14l3-3 3 2 4-5" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M3 10h18" />
          <path d="M8 14h3M8 18h5" />
        </svg>
      );
    case "news":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M8 9h8M8 13h8M8 17h5" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
        </svg>
      );
    case "help":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 1 1 4.3 1.8c-.7.7-1.8 1.3-1.8 2.7" />
          <circle cx="12" cy="17" r=".7" fill="currentColor" stroke="none" />
        </svg>
      );
    case "overview":
      return (
        <svg {...common}>
          <path d="M4 13h6V4H4z" />
          <path d="M14 9h6V4h-6z" />
          <path d="M14 20h6v-9h-6z" />
          <path d="M4 20h6v-5H4z" />
        </svg>
      );
    case "riskAlerts":
      return (
        <svg {...common}>
          <path d="M12 4l9 15H3z" />
          <path d="M12 9v5" />
          <circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none" />
        </svg>
      );
    case "marketContext":
      return (
        <svg {...common}>
          <path d="M3 7h18" />
          <path d="M3 12h18" />
          <path d="M3 17h18" />
          <circle cx="8" cy="7" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="11" cy="17" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "accounts":
      return (
        <svg {...common}>
          <circle cx="9" cy="10" r="3" />
          <path d="M4 19a5 5 0 0 1 10 0" />
          <path d="M15 9h6M18 6v6" />
        </svg>
      );
    default:
      return null;
  }
}

export default function AppSidebar({
  isOpen,
  onClose
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tSidebar = useTranslations("nav.sidebar");
  const tDashboard = useTranslations("dashboard");
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const [visibility, setVisibility] = useState<AccessSectionVisibility>(
    DEFAULT_ACCESS_SECTION_VISIBILITY
  );
  const [activeSectionHash, setActiveSectionHash] = useState<string>("");
  const [snapshot, setSnapshot] = useState<SidebarSnapshot>({
    accounts: 0,
    running: 0,
    errors: 0
  });
  const [snapshotReady, setSnapshotReady] = useState(false);
  const { pathnameWithoutLocale } = extractLocaleFromPathname(pathname);
  const isDashboardRoute = pathnameWithoutLocale === "/" || pathnameWithoutLocale === "/dashboard";

  function hrefFor(path: string): string {
    return withLocalePath(path, locale);
  }

  useEffect(() => {
    let mounted = true;

    async function loadAccessVisibility() {
      try {
        const payload = await apiGet<{ visibility?: AccessSectionVisibility }>("/settings/access-section");
        if (!mounted) return;

        if (payload?.visibility) {
          setVisibility({
            tradingDesk: payload.visibility.tradingDesk !== false,
            bots: payload.visibility.bots !== false,
            predictionsDashboard: payload.visibility.predictionsDashboard !== false,
            economicCalendar: payload.visibility.economicCalendar !== false,
            news: payload.visibility.news !== false
          });
        }
      } catch {
        if (!mounted) return;
        setVisibility(DEFAULT_ACCESS_SECTION_VISIBILITY);
      }
    }

    void loadAccessVisibility();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadSnapshot() {
      try {
        const payload = await apiGet<SidebarDashboardOverviewResponse | SidebarDashboardOverviewAccount[]>(
          "/dashboard/overview"
        );
        if (!mounted) return;

        const accounts = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.accounts)
            ? payload.accounts
            : [];
        const reduced = accounts.reduce(
          (acc, row) => {
            acc.accounts += 1;
            acc.running += Number(row?.bots?.running ?? 0) || 0;
            acc.errors += Number(row?.bots?.error ?? 0) || 0;
            return acc;
          },
          { accounts: 0, running: 0, errors: 0 }
        );
        setSnapshot(reduced);
        setSnapshotReady(true);
      } catch {
        if (!mounted) return;
        setSnapshotReady(true);
      }
    }

    void loadSnapshot();
    const timer = window.setInterval(() => {
      void loadSnapshot();
    }, 20_000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!isDashboardRoute) {
      setActiveSectionHash("");
      return;
    }

    const syncHash = () => {
      if (typeof window === "undefined") return;
      const hash = window.location.hash || "#overview";
      setActiveSectionHash(hash);
    };

    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => {
      window.removeEventListener("hashchange", syncHash);
    };
  }, [isDashboardRoute, pathname]);

  const dashboardSections = useMemo<SidebarSectionItem[]>(() => {
    return [
      { key: "overview", label: tDashboard("title"), href: "#overview", icon: "overview" },
      { key: "risk-alerts", label: tDashboard("alerts.title"), href: "#risk-alerts", icon: "riskAlerts" },
      { key: "market-context", label: tSidebar("marketContextShort"), href: "#market-context", icon: "marketContext" },
      { key: "accounts", label: tDashboard("stats.exchangeAccounts"), href: "#accounts", icon: "accounts" }
    ];
  }, [tDashboard, tSidebar]);

  const quickLinks = useMemo<SidebarItem[]>(() => {
    const items: SidebarItem[] = [];

    items.push({
      key: "dashboard",
      label: tNav("dashboard"),
      href: hrefFor("/dashboard"),
      icon: "dashboard",
      active: pathnameWithoutLocale === "/" || pathnameWithoutLocale === "/dashboard"
    });

    if (visibility.tradingDesk) {
      items.push({
        key: "manualTrading",
        label: tNav("manualTrading"),
        href: hrefFor("/trade"),
        icon: "manualTrading",
        active: pathnameWithoutLocale.startsWith("/trade") || pathnameWithoutLocale.startsWith("/trading-desk")
      });
    }

    if (visibility.bots) {
      items.push({
        key: "bots",
        label: tNav("bots"),
        href: hrefFor("/bots"),
        icon: "bots",
        active: pathnameWithoutLocale.startsWith("/bots")
      });
    }

    if (visibility.predictionsDashboard) {
      items.push({
        key: "predictions",
        label: tNav("predictions"),
        href: hrefFor("/predictions"),
        icon: "predictions",
        active: pathnameWithoutLocale.startsWith("/predictions")
      });
    }

    if (visibility.economicCalendar) {
      items.push({
        key: "calendar",
        label: tSidebar("calendarShort"),
        href: hrefFor("/calendar"),
        icon: "calendar",
        active: pathnameWithoutLocale.startsWith("/calendar")
      });
    }

    if (visibility.news) {
      items.push({
        key: "news",
        label: tNav("news"),
        href: hrefFor("/news"),
        icon: "news",
        active: pathnameWithoutLocale.startsWith("/news")
      });
    }

    items.push({
      key: "settings",
      label: tNav("settings"),
      href: hrefFor("/settings"),
      icon: "settings",
      active: pathnameWithoutLocale.startsWith("/settings")
    });

    items.push({
      key: "help",
      label: tNav("help"),
      href: hrefFor("/help"),
      icon: "help",
      active: pathnameWithoutLocale.startsWith("/help")
    });

    return items;
  }, [hrefFor, pathnameWithoutLocale, tNav, visibility]);

  return (
    <aside id="appSidebar" className={`appSidebar ${isOpen ? "appSidebarDrawer" : ""}`}>
      <div className="appSidebarInner">
        <div className="appSidebarTop">
          <Link href={hrefFor("/")} className="appSidebarLogo" aria-label="uTrade Futures" onClick={onClose}>
            <img src="/images/logo.png" alt="uTrade logo" className="appSidebarLogoMark" />
            <span className="appSidebarLogoText">{tCommon("betaLabel")}</span>
          </Link>
          <button
            type="button"
            className="appSidebarClose"
            onClick={onClose}
            aria-label={tSidebar("close")}
          >
            {tSidebar("close")}
          </button>
        </div>

        {isDashboardRoute ? (
          <section className="appSidebarSection" aria-label={tSidebar("sectionsTitle")}>
            <div className="appSidebarSectionTitle">{tSidebar("sectionsTitle")}</div>
            <nav className="appSidebarNav">
              {dashboardSections.map((item) => {
                const active = activeSectionHash === item.href || (activeSectionHash === "" && item.href === "#overview");
                return (
                  <a
                    key={item.key}
                    href={item.href}
                    className={`appSidebarLink ${active ? "appSidebarLinkActive appSidebarLinkSectionActive" : ""}`}
                    onClick={onClose}
                    aria-current={active ? "location" : undefined}
                  >
                    <span className="appSidebarLinkIcon" aria-hidden><SidebarGlyph icon={item.icon} /></span>
                    <span className="appSidebarLinkLabel">{item.label}</span>
                  </a>
                );
              })}
            </nav>
          </section>
        ) : null}

        <section className="appSidebarSection" aria-label={tSidebar("quickLinksTitle")}>
          <div className="appSidebarSectionTitle">{tSidebar("quickLinksTitle")}</div>
          <nav className="appSidebarNav">
            {quickLinks.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className={`appSidebarLink ${item.active ? "appSidebarLinkActive" : ""}`}
                onClick={onClose}
                aria-current={item.active ? "page" : undefined}
              >
                <span className="appSidebarLinkIcon" aria-hidden><SidebarGlyph icon={item.icon} /></span>
                <span className="appSidebarLinkLabel">{item.label}</span>
              </Link>
            ))}
          </nav>
        </section>

        <section className="appSidebarSection appSidebarSnapshot" aria-label={tSidebar("snapshotTitle")}>
          <div className="appSidebarSectionTitle">{tSidebar("snapshotTitle")}</div>
          <div className="appSidebarSnapshotGrid">
            <div className="appSidebarSnapshotItem">
              <span className="appSidebarSnapshotLabel">{tDashboard("stats.exchangeAccounts")}</span>
              <strong className="appSidebarSnapshotValue">{snapshotReady ? snapshot.accounts : "…"}</strong>
            </div>
            <div className="appSidebarSnapshotItem">
              <span className="appSidebarSnapshotLabel">{tDashboard("stats.runningBots")}</span>
              <strong className="appSidebarSnapshotValue">{snapshotReady ? snapshot.running : "…"}</strong>
            </div>
            <div className="appSidebarSnapshotItem">
              <span className="appSidebarSnapshotLabel">{tDashboard("stats.botsInError")}</span>
              <strong className="appSidebarSnapshotValue">{snapshotReady ? snapshot.errors : "…"}</strong>
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
}

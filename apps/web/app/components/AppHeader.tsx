"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
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
import LogoutButton from "./LogoutButton";

export default function AppHeader() {
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const [visibility, setVisibility] = useState<AccessSectionVisibility>(
    DEFAULT_ACCESS_SECTION_VISIBILITY
  );
  const {
    pathnameWithoutLocale
  } = extractLocaleFromPathname(pathname);
  const hideHeader =
    pathnameWithoutLocale === "/login"
    || pathnameWithoutLocale === "/register"
    || pathnameWithoutLocale === "/reset-password";

  const query = searchParams.toString();

  function hrefFor(path: string) {
    return withLocalePath(path, locale);
  }

  function switchLocalePath(targetLocale: AppLocale): string {
    const targetPath = withLocalePath(pathname, targetLocale);
    if (!query) return targetPath;
    return `${targetPath}?${query}`;
  }

  function handleLocaleSwitch(targetLocale: AppLocale) {
    if (targetLocale === locale) return;
    const targetPath = switchLocalePath(targetLocale);
    document.cookie = `utrade_locale=${targetLocale}; path=/; max-age=31536000`;
    window.location.assign(targetPath);
  }

  useEffect(() => {
    if (hideHeader) return;
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
            economicCalendar: payload.visibility.economicCalendar !== false
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
  }, [hideHeader]);

  if (hideHeader) return null;

  return (
    <header className="appHeader">
      <div className="container appHeaderInner">
        <div className="appHeaderTop">
          <Link href={hrefFor("/")} className="appLogo" aria-label="uTrade Futures">
            <img src="/images/logo.png" alt="uTrade logo" className="appLogoMark" />
            <span className="appLogoText">{tCommon("betaLabel")}</span>
          </Link>
          <button
            className="appBurger"
            aria-label={tNav("toggleMenu")}
            aria-expanded={menuOpen}
            aria-controls="appNav"
            onClick={() => setMenuOpen((v) => !v)}
            type="button"
          >
            <span />
            <span />
            <span />
          </button>
        </div>
        <nav id="appNav" className={`appNav ${menuOpen ? "appNavOpen" : ""}`}>
          <Link href={hrefFor("/dashboard")} className="btn">{tNav("dashboard")}</Link>
          {visibility.tradingDesk ? (
            <Link href={hrefFor("/trade")} className="btn">{tNav("manualTrading")}</Link>
          ) : null}
          {visibility.bots ? (
            <Link href={hrefFor("/bots")} className="btn">{tNav("bots")}</Link>
          ) : null}
          {visibility.predictionsDashboard ? (
            <Link href={hrefFor("/predictions")} className="btn">{tNav("predictions")}</Link>
          ) : null}
          {visibility.economicCalendar ? (
            <Link href={hrefFor("/calendar")} className="btn">{tNav("calendar")}</Link>
          ) : null}
          <Link href={hrefFor("/settings")} className="btn">{tNav("settings")}</Link>
          <Link href={hrefFor("/help")} className="btn">{tNav("help")}</Link>
          <button
            type="button"
            className={`btn ${locale === "en" ? "btnPrimary" : ""}`}
            onClick={() => handleLocaleSwitch("en")}
          >
            EN
          </button>
          <button
            type="button"
            className={`btn ${locale === "de" ? "btnPrimary" : ""}`}
            onClick={() => handleLocaleSwitch("de")}
          >
            DE
          </button>
          <LogoutButton />
        </nav>
      </div>
    </header>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import {
  extractLocaleFromPathname,
  withLocalePath,
  type AppLocale
} from "../../i18n/config";
import LogoutButton from "./LogoutButton";

export default function AppHeader() {
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const {
    pathnameWithoutLocale
  } = extractLocaleFromPathname(pathname);

  if (
    pathnameWithoutLocale === "/login"
    || pathnameWithoutLocale === "/register"
    || pathnameWithoutLocale === "/reset-password"
  ) return null;

  const query = searchParams.toString();

  function hrefFor(path: string) {
    return withLocalePath(path, locale);
  }

  function switchLocalePath(targetLocale: AppLocale): string {
    const targetPath = withLocalePath(pathname, targetLocale);
    if (!query) return targetPath;
    return `${targetPath}?${query}`;
  }

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
          <Link href={hrefFor("/trade")} className="btn">{tNav("manualTrading")}</Link>
          <Link href={hrefFor("/bots")} className="btn">{tNav("bots")}</Link>
          <Link href={hrefFor("/predictions")} className="btn">{tNav("predictions")}</Link>
          <Link href={hrefFor("/calendar")} className="btn">{tNav("calendar")}</Link>
          <Link href={hrefFor("/settings")} className="btn">{tNav("settings")}</Link>
          <Link href={hrefFor("/help")} className="btn">{tNav("help")}</Link>
          <Link href={switchLocalePath("en")} className={`btn ${locale === "en" ? "btnPrimary" : ""}`}>EN</Link>
          <Link href={switchLocalePath("de")} className={`btn ${locale === "de" ? "btnPrimary" : ""}`}>DE</Link>
          <LogoutButton />
        </nav>
      </div>
    </header>
  );
}

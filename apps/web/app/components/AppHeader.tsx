"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "../../lib/api";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import {
  DEFAULT_ACCESS_SECTION_VISIBILITY,
  type AccessSectionVisibility
} from "../../src/access/accessSection";
import LogoutButton from "./LogoutButton";

type MeResponse = {
  email?: string;
  user?: {
    email?: string;
  };
};

type HeaderSearchItem = {
  key: string;
  label: string;
  href: string;
};

export default function AppHeader({
  sidebarOpen,
  onToggleSidebar
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tHeader = useTranslations("nav.header");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [visibility, setVisibility] = useState<AccessSectionVisibility>(
    DEFAULT_ACCESS_SECTION_VISIBILITY
  );
  const blurTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadHeaderData() {
      const [accessResult, meResult] = await Promise.allSettled([
        apiGet<{ visibility?: AccessSectionVisibility }>("/settings/access-section"),
        apiGet<MeResponse>("/auth/me")
      ]);
      if (!mounted) return;

      if (accessResult.status === "fulfilled" && accessResult.value?.visibility) {
        setVisibility({
          tradingDesk: accessResult.value.visibility.tradingDesk !== false,
          bots: accessResult.value.visibility.bots !== false,
          predictionsDashboard: accessResult.value.visibility.predictionsDashboard !== false,
          economicCalendar: accessResult.value.visibility.economicCalendar !== false,
          news: accessResult.value.visibility.news !== false,
          strategy: accessResult.value.visibility.strategy !== false
        });
      } else {
        setVisibility(DEFAULT_ACCESS_SECTION_VISIBILITY);
      }

      if (meResult.status === "fulfilled") {
        const email = String(meResult.value?.email ?? meResult.value?.user?.email ?? "").trim();
        setUserEmail(email);
      } else {
        setUserEmail("");
      }
    }

    void loadHeaderData();
    return () => {
      mounted = false;
    };
  }, []);

  const searchItems = useMemo<HeaderSearchItem[]>(() => {
    const items: HeaderSearchItem[] = [
      { key: "dashboard", label: tNav("dashboard"), href: withLocalePath("/dashboard", locale) }
    ];

    if (visibility.tradingDesk) {
      items.push({ key: "trade", label: tNav("manualTrading"), href: withLocalePath("/trade", locale) });
    }
    if (visibility.bots) {
      items.push({ key: "bots", label: tNav("bots"), href: withLocalePath("/bots", locale) });
    }
    if (visibility.predictionsDashboard) {
      items.push({ key: "predictions", label: tNav("predictions"), href: withLocalePath("/predictions", locale) });
    }
    if (visibility.economicCalendar) {
      items.push({ key: "calendar", label: tNav("calendar"), href: withLocalePath("/calendar", locale) });
    }
    if (visibility.news) {
      items.push({ key: "news", label: tNav("news"), href: withLocalePath("/news", locale) });
    }

    items.push({ key: "settings", label: tNav("settings"), href: withLocalePath("/settings", locale) });
    items.push({ key: "help", label: tNav("help"), href: withLocalePath("/help", locale) });
    return items;
  }, [locale, tNav, visibility]);

  const username = useMemo(() => {
    const email = userEmail.trim();
    if (!email) return tHeader("userFallback");
    const at = email.indexOf("@");
    return at > 0 ? email.slice(0, at) : email;
  }, [tHeader, userEmail]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return searchItems.filter((item) => item.label.toLowerCase().includes(normalized)).slice(0, 8);
  }, [query, searchItems]);

  const showSearchResults = isSearchFocused && query.trim().length > 0 && filteredItems.length > 0;

  useEffect(() => {
    if (!showSearchResults) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex((previous) => Math.min(previous, filteredItems.length - 1));
  }, [filteredItems.length, showSearchResults]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current !== null) {
        window.clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  function navigateToHref(href: string) {
    router.push(href);
    setQuery("");
    setActiveIndex(-1);
    setIsSearchFocused(false);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const activeItem = activeIndex >= 0 ? filteredItems[activeIndex] : null;
    if (activeItem) {
      navigateToHref(activeItem.href);
      return;
    }

    const normalized = query.trim().toLowerCase();
    if (!normalized) return;

    const exact = searchItems.find((item) => item.label.toLowerCase() === normalized);
    const startsWith = searchItems.find((item) => item.label.toLowerCase().startsWith(normalized));
    const includes = searchItems.find((item) => item.label.toLowerCase().includes(normalized));
    const match = exact ?? startsWith ?? includes;

    if (match) {
      navigateToHref(match.href);
      return;
    }

    if (normalized.startsWith("/")) {
      navigateToHref(withLocalePath(normalized, locale));
    }
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSearchResults && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((previous) => (previous + 1) % filteredItems.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((previous) => (previous <= 0 ? filteredItems.length - 1 : previous - 1));
      return;
    }

    if (event.key === "Escape") {
      setIsSearchFocused(false);
      setActiveIndex(-1);
    }
  }

  return (
    <header className="appHeader appHeaderCompact">
      <div className="container appHeaderInner">
        <Link href={withLocalePath("/", locale)} className="appLogo appHeaderMobileLogo" aria-label="uTrade Futures">
          <img src="/images/logo.png" alt="uTrade logo" className="appLogoMark" />
          <span className="appLogoText">{tCommon("betaLabel")}</span>
        </Link>

        <form className="appHeaderSearch" onSubmit={handleSubmit}>
          <div className="appHeaderSearchWrap">
            <input
              className="input appHeaderSearchInput"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
              onFocus={() => {
                if (blurTimeoutRef.current !== null) {
                  window.clearTimeout(blurTimeoutRef.current);
                  blurTimeoutRef.current = null;
                }
                setIsSearchFocused(true);
              }}
              onBlur={() => {
                blurTimeoutRef.current = window.setTimeout(() => {
                  setIsSearchFocused(false);
                  setActiveIndex(-1);
                }, 120);
              }}
              placeholder={tHeader("searchPlaceholder")}
              aria-label={tHeader("searchPlaceholder")}
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showSearchResults}
              aria-controls="appHeaderSearchResults"
              aria-activedescendant={
                activeIndex >= 0 ? `appHeaderSearchResult-${filteredItems[activeIndex]?.key}` : undefined
              }
            />
            {showSearchResults ? (
              <div id="appHeaderSearchResults" className="appHeaderSearchResults" role="listbox">
                {filteredItems.map((item, index) => {
                  const isActive = index === activeIndex;
                  return (
                    <button
                      key={item.key}
                      id={`appHeaderSearchResult-${item.key}`}
                      type="button"
                      className={`appHeaderSearchResult ${isActive ? "appHeaderSearchResultActive" : ""}`}
                      role="option"
                      aria-selected={isActive}
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={() => navigateToHref(item.href)}
                    >
                      <span className="appHeaderSearchResultLabel">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <button type="submit" className="btn appHeaderSearchBtn">{tHeader("searchButton")}</button>
        </form>

        <div className="appHeaderActions">
          <button
            className="appBurger appBurgerVisible"
            aria-label={tNav("toggleMenu")}
            aria-expanded={sidebarOpen}
            aria-controls="appSidebar"
            onClick={onToggleSidebar}
            type="button"
          >
            <span />
            <span />
            <span />
          </button>
          <span className="appHeaderUserName" title={userEmail || username}>{username}</span>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}

"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { extractLocaleFromPathname } from "../../i18n/config";
import AppHeader from "./AppHeader";
import AppSidebar from "./AppSidebar";
import SystemBanner from "./SystemBanner";

const AUTH_ROUTES = new Set(["/login", "/register", "/reset-password"]);

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const tSidebar = useTranslations("nav.sidebar");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { pathnameWithoutLocale } = extractLocaleFromPathname(pathname);
  const hideChrome = AUTH_ROUTES.has(pathnameWithoutLocale);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!sidebarOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [sidebarOpen]);

  if (hideChrome) {
    return (
      <>
        <SystemBanner />
        <main className="container appMain">{children}</main>
      </>
    );
  }

  return (
    <div className="appShell appShellWithSidebar">
      <AppSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="appShellContent">
        <AppHeader
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
        />
        <SystemBanner />
        <main className="container appMain">{children}</main>
      </div>

      <button
        type="button"
        className={`appSidebarBackdrop ${sidebarOpen ? "appSidebarBackdropOpen" : ""}`}
        onClick={() => setSidebarOpen(false)}
        aria-label={tSidebar("close")}
      />
    </div>
  );
}

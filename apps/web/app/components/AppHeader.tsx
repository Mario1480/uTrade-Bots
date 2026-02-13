"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import LogoutButton from "./LogoutButton";

export default function AppHeader() {
  const pathname = usePathname();
  if (pathname === "/login" || pathname === "/register" || pathname === "/reset-password") return null;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="appHeader">
      <div className="container appHeaderInner">
        <div className="appHeaderTop">
          <Link href="/" className="appLogo" aria-label="uTrade Futures">
            <img src="/images/logo.png" alt="uTrade logo" className="appLogoMark" />
            <span className="appLogoText">Panel Beta v0.0.1</span>
          </Link>
          <button
            className="appBurger"
            aria-label="Toggle menu"
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
          <Link href="/dashboard" className="btn">Dashboard</Link>
          <Link href="/trade" className="btn">Manual Trading Desk</Link>
          <Link href="/bots" className="btn">Bots</Link>
          <Link href="/predictions" className="btn">Predictions</Link>
          <Link href="/calendar" className="btn">Economic Calendar</Link>
          <Link href="/settings" className="btn">Settings</Link>
          <Link href="/help" className="btn">Help</Link>
          <LogoutButton />
        </nav>
      </div>
    </header>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import LogoutButton from "./LogoutButton";

export default function AppHeader() {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="appHeader">
      <div className="container appHeaderInner">
        <div className="appHeaderTop">
          <Link href="/" className="appLogo" aria-label="Market Maker">
            <img src="/images/logo.png" alt="uLiquid logo" className="appLogoMark" />
            <span className="appLogoText">uLiquid</span>
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
          <Link href="/" className="btn">Dashboard</Link>
          <Link href="/settings" className="btn btnPrimary">Settings</Link>
          <Link href="/help" className="btn">Help</Link>
          <LogoutButton />
        </nav>
      </div>
    </header>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError, apiGet } from "../../lib/api";

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

type AdminLinkItem = {
  href: string;
  title: string;
  description: string;
  category: "Access" | "Integrations" | "Strategy";
};

const ADMIN_LINKS: AdminLinkItem[] = [
  {
    href: "/admin/users",
    title: "Users",
    description: "Search, create, update password and delete users.",
    category: "Access"
  },
  {
    href: "/admin/telegram",
    title: "Global Telegram",
    description: "Set global bot token/chat and send test alerts.",
    category: "Integrations"
  },
  {
    href: "/admin/exchanges",
    title: "Offered Exchanges",
    description: "Select which CEX options are available to users.",
    category: "Integrations"
  },
  {
    href: "/admin/smtp",
    title: "SMTP",
    description: "Configure SMTP transport and send test email.",
    category: "Integrations"
  },
  {
    href: "/admin/api-keys",
    title: "API Keys",
    description: "Store global API keys (starting with OpenAI) encrypted in DB.",
    category: "Integrations"
  },
  {
    href: "/admin/indicator-settings",
    title: "Indicator Settings",
    description: "Configure feature packs and indicator params with scoped overrides.",
    category: "Strategy"
  },
  {
    href: "/admin/prediction-refresh",
    title: "Prediction Refresh",
    description: "Tune debounce, hysteresis, cooldown and event throttle for auto predictions.",
    category: "Strategy"
  },
  {
    href: "/admin/prediction-defaults",
    title: "Prediction Defaults",
    description: "Configure global defaults like signal mode for newly created predictions.",
    category: "Strategy"
  },
  {
    href: "/admin/ai-prompts",
    title: "AI Prompts",
    description: "Manage explainer prompt text and indicator groups sent to AI.",
    category: "Strategy"
  },
  {
    href: "/admin/ai-trace",
    title: "AI Trace Logs",
    description: "Inspect AI request payloads/responses with on/off toggle and cleanup.",
    category: "Strategy"
  }
];

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filteredLinks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return ADMIN_LINKS;
    return ADMIN_LINKS.filter((item) =>
      [item.title, item.description, item.category].some((value) =>
        value.toLowerCase().includes(needle)
      )
    );
  }, [query]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const me = await apiGet<any>("/auth/me");
        setIsSuperadmin(Boolean(me?.isSuperadmin || me?.hasAdminBackendAccess));
        if (!(me?.isSuperadmin || me?.hasAdminBackendAccess)) setError("Admin backend access required.");
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) {
    return <div className="settingsWrap">Loading admin backend...</div>;
  }

  return (
    <div className="settingsWrap">
      <div className="adminTopActions">
        <Link href="/settings" className="btn">
          ← Back to settings
        </Link>
        <Link href="/" className="btn">
          ← Back to dashboard
        </Link>
      </div>
      <h2 style={{ marginTop: 0 }}>Admin Backend</h2>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
        Select a section.
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
                {filteredLinks.length} of {ADMIN_LINKS.length} sections
              </div>
              <input
                className="input adminLandingSearch"
                placeholder="Search admin sections..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </section>

          {filteredLinks.length === 0 ? (
            <section className="card settingsSection">
              <div className="settingsMutedText">No admin section matches your search.</div>
            </section>
          ) : null}

          <div className="adminLandingGrid">
            {filteredLinks.map((item) => (
              <article key={item.href} className="card settingsSection adminLandingCard">
                <div className="adminLandingCardHeader">
                  <h3 style={{ margin: 0 }}>{item.title}</h3>
                  <span className="badge adminLandingBadge">{item.category}</span>
                </div>
                <div className="adminLandingDesc">
                  {item.description}
                </div>
                <div className="adminLandingActions">
                  <Link href={item.href} className="btn btnPrimary">
                    Open {item.title}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

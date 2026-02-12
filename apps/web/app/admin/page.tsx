"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiGet } from "../../lib/api";

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

const ADMIN_LINKS = [
  {
    href: "/admin/users",
    title: "Users",
    description: "Search, create, update password and delete users."
  },
  {
    href: "/admin/telegram",
    title: "Global Telegram",
    description: "Set global bot token/chat and send test alerts."
  },
  {
    href: "/admin/exchanges",
    title: "Offered Exchanges",
    description: "Select which CEX options are available to users."
  },
  {
    href: "/admin/smtp",
    title: "SMTP",
    description: "Configure SMTP transport and send test email."
  },
  {
    href: "/admin/api-keys",
    title: "API Keys",
    description: "Store global API keys (starting with OpenAI) encrypted in DB."
  },
  {
    href: "/admin/prediction-refresh",
    title: "Prediction Refresh",
    description: "Tune debounce, hysteresis, cooldown and event throttle for auto predictions."
  }
];

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const me = await apiGet<any>("/auth/me");
        setIsSuperadmin(Boolean(me?.isSuperadmin));
        if (!me?.isSuperadmin) setError("Superadmin access required.");
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
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
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
        <div className="card settingsSection" style={{ borderColor: "#ef4444", marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      {isSuperadmin ? (
        <div style={{ display: "grid", gap: 12 }}>
          {ADMIN_LINKS.map((item) => (
            <div key={item.href} className="card settingsSection">
              <div className="settingsSectionHeader">
                <h3 style={{ margin: 0 }}>{item.title}</h3>
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
                {item.description}
              </div>
              <Link href={item.href} className="btn btnPrimary">
                Open {item.title}
              </Link>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

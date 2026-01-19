"use client";

import Link from "next/link";

const HELP_SECTIONS = [
  {
    id: "getting-started",
    title: "Getting Started",
    body: [
      "Create a bot by selecting an exchange and a trading pair, then save the configuration and start the bot.",
      "Tip: use Config Presets to save a known-good setup and apply it to new bots quickly."
    ]
  },
  {
    id: "exchange-keys",
    title: "Exchange API Keys",
    body: [
      "Required permissions: trade only (no withdrawals).",
      "Keys are protected; viewing or editing requires Re-Auth (OTP).",
      "Common issues: invalid key, IP whitelist not updated, missing trade permissions."
    ]
  },
  {
    id: "bot-settings",
    title: "Bot Settings Explained",
    body: [
      "Market Making: spread, levels, step, distribution, jitter, skew, max skew.",
      "Volume Bot: daily target, min/max trade, mode.",
      "Risk: min balance, max deviation, max open orders, daily loss."
    ]
  },
  {
    id: "price-support",
    title: "Price Support",
    body: [
      "When mid price drops below the floor, Price Support buys until mid is back above the floor.",
      "It uses a separate budget and stops automatically when the budget is depleted.",
      "A Telegram notification is sent on depletion, and a manual restart is required."
    ]
  },
  {
    id: "price-follow",
    title: "Price Follow (Master / Slave)",
    body: [
      "The master exchange provides the price feed (no bot required on master).",
      "The slave exchange executes trades based on that master feed.",
      "Stale master feed and deviation protection prevent unsafe orders."
    ]
  },
  {
    id: "manual-trading",
    title: "Manual Trading",
    body: [
      "Manual limit and market orders are available if enabled by your admin.",
      "Re-Auth (OTP) is required for manual trading actions.",
      "Market orders include a slippage warning and should be used carefully."
    ]
  },
  {
    id: "roles",
    title: "Users, Roles & Permissions",
    body: [
      "Roles include Superadmin, Admin, Operator, and Viewer.",
      "Permissions are configurable per workspace role.",
      "Best practice: use least privilege for day-to-day operations."
    ]
  },
  {
    id: "security",
    title: "Security",
    body: [
      "Cookie-based sessions are protected with CSRF safeguards.",
      "Re-Auth (OTP) is required for sensitive actions.",
      "Optional Email 2FA is available.",
      "Audit logs help track sensitive changes and actions."
    ]
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    body: [
      "Bot shows ERROR: check runtime reason, keys, balances, and exchange health.",
      "No orders: config too strict, price follow deviation, or post-only rejects.",
      "Runner not updating: check runner status and readiness endpoints."
    ]
  }
];

export default function HelpPage() {
  return (
    <div>
      <div className="dashboardHeader">
        <div>
          <h2 style={{ margin: 0 }}>Support &amp; Help</h2>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Guides for setup, security, and troubleshooting.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/" className="btn">← Back to dashboard</Link>
          <Link href="/settings" className="btn">← Back to settings</Link>
        </div>
      </div>

      <section className="card" style={{ padding: 12, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Quick Links</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {HELP_SECTIONS.map((s) => (
            <a key={s.id} className="btn" href={`#${s.id}`}>
              {s.title}
            </a>
          ))}
        </div>
      </section>

      <section className="card" style={{ padding: 12 }}>
        <div style={{ display: "grid", gap: 10 }}>
          {HELP_SECTIONS.map((section) => (
            <details key={section.id} id={section.id} className="card" style={{ padding: 12 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>{section.title}</summary>
              <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                {section.body.map((line, idx) => (
                  <div key={idx} style={{ fontSize: 13, color: "var(--muted)" }}>
                    {line}
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="card" style={{ padding: 12, marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Contact Support</h3>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Please include your workspace name, bot name or ID, a timestamp, a screenshot, and relevant api/runner logs.
        </div>
        <div style={{ marginTop: 8 }}>
          <a className="btn btnPrimary" href="mailto:support@uliquid.vip">
            support@uliquid.vip
          </a>
        </div>
      </section>
    </div>
  );
}

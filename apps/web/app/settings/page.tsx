import Link from "next/link";

export default function SettingsPage() {
  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ marginBottom: 10 }}>
        <Link href="/" className="btn">
          ← Back to dashboard
        </Link>
      </div>
      <h2 style={{ marginTop: 0 }}>Settings</h2>
      <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 12 }}>
        Settings are grouped by area.
      </div>

      <div className="homeGrid homeGridEqual" style={{ marginBottom: 16 }}>
        <Link className="card" href="/settings/exchange-accounts" style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Exchange accounts</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Manage your connected trading accounts</div>
        </Link>
        <Link className="card" href="/settings/notifications" style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Notifications</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Alerts and delivery channels</div>
        </Link>
        <Link className="card" href="/settings/subscription" style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Subscription</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>License Management</div>
        </Link>
        <Link className="card" href="/settings/users" style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>My Account</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Password and personal security</div>
        </Link>
        <Link className="card" href="/settings/roles" style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Members & Roles</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Workspace members and permissions</div>
        </Link>
        <Link className="card" href="/settings/audit" style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Audit</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Activity log</div>
        </Link>
        <Link className="card" href="/settings/global-defaults" style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Global Defaults</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Superadmin settings</div>
        </Link>
        <Link className="card" href="/settings/setup" style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Bot Setup</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Bot list and setup</div>
        </Link>
      </div>
    </div>
  );
}

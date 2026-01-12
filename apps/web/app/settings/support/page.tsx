import Link from "next/link";

export default function SupportPage() {
  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/settings" className="btn">
          ← Back to settings
        </Link>
        <Link href="/" className="btn">
          ← Back to dashboard
        </Link>
      </div>
      <h2 style={{ marginTop: 0 }}>Support & Help</h2>
      <div className="card" style={{ padding: 12, fontSize: 13 }}>
        Placeholder: Docs, status, and contact.
      </div>
    </div>
  );
}

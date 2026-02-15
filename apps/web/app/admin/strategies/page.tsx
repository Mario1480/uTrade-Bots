import Link from "next/link";

export default function AdminStrategiesIndexPage() {
  return (
    <div className="settingsWrap">
      <div className="adminTopActions">
        <Link href="/admin" className="btn">← Back to admin</Link>
      </div>

      <div className="adminPageIntro">
        <h2 style={{ marginTop: 0 }}>Strategies</h2>
        <p className="settingsMutedText">Manage local, AI, and composite strategies.</p>
      </div>

      <section className="card settingsSection" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/admin/strategies/local" className="btn btnPrimary">Local Strategies</Link>
          <Link href="/admin/strategies/ai" className="btn">AI Strategies</Link>
          <Link href="/admin/strategies/builder" className="btn">Composite Builder</Link>
        </div>
      </section>
    </div>
  );
}

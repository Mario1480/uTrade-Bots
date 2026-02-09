import Link from "next/link";

export default async function BotSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Bot Settings</h2>
      <div className="card" style={{ padding: 14 }}>
        <p style={{ marginTop: 0 }}>
          Futures skeleton mode is active. Advanced per-bot settings are intentionally reduced.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={`/bots/${id}`} className="btn">Back to Bot</Link>
          <Link href="/" className="btn">Dashboard</Link>
        </div>
      </div>
    </div>
  );
}

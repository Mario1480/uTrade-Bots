import Link from "next/link";

export default async function PriceSupportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Futures Extensions</h2>
      <div className="card" style={{ padding: 14 }}>
        <p style={{ marginTop: 0 }}>
          This route is reserved for future futures-specific extensions.
        </p>
        <Link href={`/bots/${id}`} className="btn">Back to Bot</Link>
      </div>
    </div>
  );
}

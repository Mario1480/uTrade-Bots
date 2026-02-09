import type { CSSProperties } from "react";

type LiveViewProps = {
  runtime: {
    status?: string;
    reason?: string | null;
    updatedAt?: string;
  } | null;
};

export function LiveView({ runtime }: LiveViewProps) {
  return (
    <section className="card" style={{ padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>Live Runtime</h3>
      {!runtime ? (
        <div style={{ fontSize: 12, opacity: 0.8 }}>No runtime records yet.</div>
      ) : (
        <div className="gridTwoCol" style={{ "--grid-gap": "8px" } as CSSProperties}>
          <Kv k="Status" v={runtime.status ?? "-"} />
          <Kv k="Reason" v={runtime.reason ?? "-"} />
          <Kv k="Updated" v={formatUpdated(runtime.updatedAt)} />
        </div>
      )}
    </section>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="card" style={{ padding: "8px 10px" }}>
      <div style={{ fontSize: 11, opacity: 0.7 }}>{k}</div>
      <div style={{ fontSize: 13 }}>{v}</div>
    </div>
  );
}

function formatUpdated(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

type LiveViewProps = {
  runtime: any;
};

export function LiveView({ runtime }: LiveViewProps) {
  return (
    <Section title="Live Snapshot">
      {!runtime ? (
        <div style={{ fontSize: 12, opacity: 0.8 }}>No runtime yet (runner not started?)</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Kv k="mid" v={runtime.mid} />
            <Kv k="bid" v={runtime.bid} />
            <Kv k="ask" v={runtime.ask} />
            <Kv k="openOrders" v={runtime.openOrders} />
            <Kv k="openOrdersMm" v={runtime.openOrdersMm} />
            <Kv k="openOrdersVol" v={runtime.openOrdersVol} />
            <Kv k="lastVolClientOrderId" v={runtime.lastVolClientOrderId} />
            <Kv k="freeUsdt" v={runtime.freeUsdt} />
            <Kv k="freeBase" v={runtime.freeBase} />
            <Kv k="tradedNotionalToday" v={runtime.tradedNotionalToday} />
            <Kv k="updatedAt" v={runtime.updatedAt} />
          </div>

          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer" }}>Raw runtime JSON</summary>
            <pre style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{JSON.stringify(runtime, null, 2)}</pre>
          </details>
        </>
      )}
    </Section>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="card" style={{ padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>{props.title}</h3>
      {props.children}
    </section>
  );
}

function Kv(props: { k: string; v: any }) {
  return (
    <div className="card" style={{ padding: "8px 10px" }}>
      <div style={{ fontSize: 11, opacity: 0.7 }}>{props.k}</div>
      <div style={{ fontSize: 13, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
        {props.v === null || props.v === undefined ? "—" : String(props.v)}
      </div>
    </div>
  );
}

type ConfigFormProps = {
  mm: any;
  vol: any;
  risk: any;
  onMmChange: (next: any) => void;
  onVolChange: (next: any) => void;
  onRiskChange: (next: any) => void;
};

export function ConfigForm({ mm, vol, risk, onMmChange, onVolChange, onRiskChange }: ConfigFormProps) {
  return (
    <>
      <Section title="Market Making">
        <Field label="Spread (%)" value={mm.spreadPct} onChange={(v) => onMmChange({ ...mm, spreadPct: Number(v) })} />
        <Field label="Step (%)" value={mm.stepPct} onChange={(v) => onMmChange({ ...mm, stepPct: Number(v) })} />
        <Field label="Levels Up" value={mm.levelsUp} onChange={(v) => onMmChange({ ...mm, levelsUp: Number(v) })} />
        <Field label="Levels Down" value={mm.levelsDown} onChange={(v) => onMmChange({ ...mm, levelsDown: Number(v) })} />
        <Field label="Quote Budget (USDT)" value={mm.budgetQuoteUsdt} onChange={(v) => onMmChange({ ...mm, budgetQuoteUsdt: Number(v) })} />
        <Field label="Base Budget (Token)" value={mm.budgetBaseToken} onChange={(v) => onMmChange({ ...mm, budgetBaseToken: Number(v) })} />
        <SelectField
          label="Distribution"
          value={mm.distribution}
          options={[
            { label: "Linear", value: "LINEAR" },
            { label: "Valley", value: "VALLEY" },
            { label: "Random", value: "RANDOM" }
          ]}
          onChange={(v) => onMmChange({ ...mm, distribution: v })}
        />
        <Field label="Jitter (%)" value={mm.jitterPct} onChange={(v) => onMmChange({ ...mm, jitterPct: Number(v) })} />
        <Field label="Skew Factor" value={mm.skewFactor} onChange={(v) => onMmChange({ ...mm, skewFactor: Number(v) })} />
        <Field label="Max Skew" value={mm.maxSkew} onChange={(v) => onMmChange({ ...mm, maxSkew: Number(v) })} />
      </Section>

      <Section title="Volume Bot">
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
          Passive = post-only around mid. Mixed may place occasional market orders.
        </div>
        <Field label="Daily Notional (USDT)" value={vol.dailyNotionalUsdt} onChange={(v) => onVolChange({ ...vol, dailyNotionalUsdt: Number(v) })} />
        <Field label="Min Trade (USDT)" value={vol.minTradeUsdt} onChange={(v) => onVolChange({ ...vol, minTradeUsdt: Number(v) })} />
        <Field label="Max Trade (USDT)" value={vol.maxTradeUsdt} onChange={(v) => onVolChange({ ...vol, maxTradeUsdt: Number(v) })} />
        <Field label="Active From (HH:MM)" value={vol.activeFrom} onChange={(v) => onVolChange({ ...vol, activeFrom: v })} />
        <Field label="Active To (HH:MM)" value={vol.activeTo} onChange={(v) => onVolChange({ ...vol, activeTo: v })} />
        <SelectField
          label="Mode"
          value={vol.mode}
          options={[
            { label: "Passive", value: "PASSIVE" },
            { label: "Mixed", value: "MIXED" }
          ]}
          onChange={(v) => onVolChange({ ...vol, mode: v })}
        />
      </Section>

      <Section title="Risk">
        <Field label="Min Balance (USDT)" value={risk.minUsdt} onChange={(v) => onRiskChange({ ...risk, minUsdt: Number(v) })} />
        <Field label="Max Deviation (%)" value={risk.maxDeviationPct} onChange={(v) => onRiskChange({ ...risk, maxDeviationPct: Number(v) })} />
        <Field label="Max Open Orders" value={risk.maxOpenOrders} onChange={(v) => onRiskChange({ ...risk, maxOpenOrders: Number(v) })} />
        <Field label="Max Daily Loss (USDT)" value={risk.maxDailyLoss} onChange={(v) => onRiskChange({ ...risk, maxDailyLoss: Number(v) })} />
      </Section>
    </>
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

function Field(props: { label: string; value: any; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 8, marginBottom: 8, alignItems: "center" }}>
      <span style={{ fontSize: 13 }}>{props.label}</span>
      <input
        value={props.value ?? ""}
        onChange={(e) => props.onChange(e.target.value)}
        className="input"
      />
    </label>
  );
}

function SelectField(props: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 8, marginBottom: 8, alignItems: "center" }}>
      <span style={{ fontSize: 13 }}>{props.label}</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="input"
      >
        {props.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

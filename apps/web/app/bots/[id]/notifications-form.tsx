type NotificationsFormProps = {
  notify: any;
  onChange: (next: any) => void;
};

export function NotificationsForm({ notify, onChange }: NotificationsFormProps) {
  return (
    <details className="card" style={{ padding: 12, marginBottom: 16 }} open>
      <summary style={{ cursor: "pointer", fontWeight: 700, marginBottom: 10 }}>Notifications</summary>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
        Configure warning thresholds before the bot auto-pauses on low funds.
      </div>
      <label className="fieldRow">
        <span style={{ fontSize: 13 }}>Enable funds warning</span>
        <input
          type="checkbox"
          checked={Boolean(notify.fundsWarnEnabled)}
          onChange={(e) => onChange({ ...notify, fundsWarnEnabled: e.target.checked })}
        />
      </label>
      <label className="fieldRow">
        <span style={{ fontSize: 13 }}>
          Reserve warning (%)
          <span style={{ display: "block", fontSize: 11, opacity: 0.7 }}>
            Warn when funds drop below this reserve above required budgets.
          </span>
        </span>
        <input
          className="input"
          inputMode="decimal"
          value={formatPct(notify.fundsWarnPct)}
          onChange={(e) => onChange({ ...notify, fundsWarnPct: parsePct(e.target.value, notify.fundsWarnPct) })}
        />
      </label>
    </details>
  );
}

function formatPct(value: number) {
  if (!Number.isFinite(value)) return "";
  return String(Math.round(value * 10000) / 100);
}

function parsePct(raw: string, fallback: number) {
  const v = raw.replace(",", ".");
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n / 100);
}

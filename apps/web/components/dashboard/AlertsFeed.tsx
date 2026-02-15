"use client";

import Link from "next/link";

export type DashboardAlert = {
  id: string;
  severity: "critical" | "warning" | "info";
  type:
    | "API_DOWN"
    | "SYNC_FAIL"
    | "BOT_ERROR"
    | "MARGIN_WARN"
    | "CIRCUIT_BREAKER"
    | "AI_PAYLOAD_BUDGET";
  title: string;
  message?: string;
  exchange?: string;
  exchangeAccountId?: string;
  botId?: string;
  ts: string;
  link?: string;
};

function formatAgo(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "now";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function badgeClass(severity: DashboardAlert["severity"]): string {
  if (severity === "critical") return "badge badgeDanger dashboardAlertBadge";
  if (severity === "warning") return "badge badgeWarn dashboardAlertBadge";
  return "badge dashboardAlertBadge";
}

export default function AlertsFeed({ alerts }: { alerts: DashboardAlert[] }) {
  return (
    <section className="card dashboardAlertsCard">
      <div className="dashboardAlertsTitle">Global Alerts</div>
      {alerts.length === 0 ? (
        <div className="dashboardAlertsEmpty">No active alerts.</div>
      ) : (
        <div className="dashboardAlertsList">
          {alerts.map((alert) => {
            const content = (
              <div className={`dashboardAlertItem dashboardAlertItem-${alert.severity}`}>
                <div className="dashboardAlertTop">
                  <span className={badgeClass(alert.severity)}>{alert.severity.toUpperCase()}</span>
                  <span className="dashboardAlertTime" title={new Date(alert.ts).toLocaleString()}>
                    {formatAgo(alert.ts)}
                  </span>
                </div>
                <div className="dashboardAlertText">{alert.title}</div>
                {alert.message ? (
                  <div className="dashboardAlertMessage">
                    {alert.message}
                  </div>
                ) : null}
              </div>
            );

            if (alert.link) {
              return (
                <Link key={alert.id} href={alert.link} className="dashboardAlertLink">
                  {content}
                </Link>
              );
            }
            return <div key={alert.id}>{content}</div>;
          })}
        </div>
      )}
    </section>
  );
}

"use client";

export type DashboardTotals = {
  totalEquity: number;
  totalAvailableMargin: number;
  totalTodayPnl: number;
  currency: "USDT";
  includedAccounts: number;
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

export default function TotalsBar({ totals }: { totals: DashboardTotals | null }) {
  if (!totals) return null;

  return (
    <div className="statGrid dashboardTotalsBar">
      <div className="card statCard">
        <div className="statLabel">Total Equity ({totals.currency})</div>
        <div className="statValue">{formatMoney(totals.totalEquity)}</div>
      </div>
      <div className="card statCard">
        <div className="statLabel">Total Available Margin ({totals.currency})</div>
        <div className="statValue">{formatMoney(totals.totalAvailableMargin)}</div>
      </div>
      <div className="card statCard">
        <div className="statLabel">Total Today PnL ({totals.currency})</div>
        <div className="statValue">{formatMoney(totals.totalTodayPnl)}</div>
        <div className="dashboardTotalsMeta">
          Included accounts: {totals.includedAccounts}
        </div>
      </div>
    </div>
  );
}

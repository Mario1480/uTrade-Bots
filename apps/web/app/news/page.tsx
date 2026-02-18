"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet } from "../../lib/api";

type NewsMode = "all" | "crypto" | "general";
type NewsFeed = "crypto" | "general";

type NewsItem = {
  id: string;
  source: "fmp";
  feed: NewsFeed;
  title: string;
  url: string;
  site: string | null;
  publishedAt: string;
  imageUrl: string | null;
  symbol: string | null;
  text: string | null;
};

type NewsResponse = {
  items: NewsItem[];
  meta: {
    mode: NewsMode;
    page: number;
    limit: number;
    cache: "hit" | "miss";
    fetchedAt: string;
    partial?: boolean;
    searchQuery?: string;
    searchApplied?: boolean;
    searchFallback?: boolean;
  };
};

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as any).message);
  return String(error);
}

function toDateInput(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

export default function NewsPage() {
  const t = useTranslations("system.news");
  const locale = useLocale();
  const dateLocale = locale === "de" ? "de-DE" : "en-GB";
  const [mode, setMode] = useState<NewsMode>("all");
  const [limit, setLimit] = useState(20);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [symbols, setSymbols] = useState("");
  const [from, setFrom] = useState(() => toDateInput(addDays(new Date(), -1)));
  const [to, setTo] = useState(() => toDateInput(addDays(new Date(), 1)));
  const [items, setItems] = useState<NewsItem[]>([]);
  const [meta, setMeta] = useState<NewsResponse["meta"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("mode", mode);
    params.set("limit", String(limit));
    params.set("page", String(page));
    const queryRaw = search.trim();
    if (queryRaw && mode !== "general") params.set("q", queryRaw);
    const symbolRaw = symbols.trim();
    if (symbolRaw) params.set("symbols", symbolRaw);
    if (mode !== "crypto") {
      if (from) params.set("from", from);
      if (to) params.set("to", to);
    }
    return params.toString();
  }, [mode, limit, page, search, symbols, from, to]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<NewsResponse>(`/news?${query}`);
      setItems(Array.isArray(response.items) ? response.items : []);
      setMeta(response.meta ?? null);
    } catch (e) {
      setError(errMsg(e));
      setItems([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="newsPage">
      <div className="dashboardHeader">
        <div>
          <h2 style={{ margin: 0 }}>{t("title")}</h2>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{t("subtitle")}</div>
        </div>
      </div>

      <div className="card newsFilterCard">
        <div className="newsTabRow">
          <button
            type="button"
            className={`btn ${mode === "all" ? "btnPrimary" : ""}`}
            onClick={() => {
              setMode("all");
              setPage(0);
            }}
          >
            {t("tabs.all")}
          </button>
          <button
            type="button"
            className={`btn ${mode === "crypto" ? "btnPrimary" : ""}`}
            onClick={() => {
              setMode("crypto");
              setPage(0);
            }}
          >
            {t("tabs.crypto")}
          </button>
          <button
            type="button"
            className={`btn ${mode === "general" ? "btnPrimary" : ""}`}
            onClick={() => {
              setMode("general");
              setPage(0);
            }}
          >
            {t("tabs.general")}
          </button>
        </div>

        <div className="newsFilterGrid">
          <label className="newsFilterField">
            <div className="newsFilterLabel">{t("filters.limit")}</div>
            <select
              className="input"
              value={limit}
              onChange={(event) => {
                setLimit(Number(event.target.value));
                setPage(0);
              }}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={30}>30</option>
              <option value={50}>50</option>
            </select>
          </label>

          <label className="newsFilterField">
            <div className="newsFilterLabel">{t("filters.page")}</div>
            <select className="input" value={page} onChange={(event) => setPage(Number(event.target.value))}>
              {Array.from({ length: 6 }).map((_, index) => (
                <option key={index} value={index}>
                  {index}
                </option>
              ))}
            </select>
          </label>

          {(mode === "all" || mode === "crypto") ? (
            <label className="newsFilterField">
              <div className="newsFilterLabel">{t("filters.search")}</div>
              <input
                className="input"
                placeholder={t("filters.searchPlaceholder")}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
            </label>
          ) : null}

          {(mode === "all" || mode === "crypto") ? (
            <label className="newsFilterField">
              <div className="newsFilterLabel">{t("filters.symbols")}</div>
              <input
                className="input"
                placeholder={t("filters.symbolsPlaceholder")}
                value={symbols}
                onChange={(event) => {
                  setSymbols(event.target.value);
                  setPage(0);
                }}
              />
            </label>
          ) : null}

          {mode !== "crypto" ? (
            <>
              <label className="newsFilterField">
                <div className="newsFilterLabel">{t("filters.from")}</div>
                <input
                  className="input"
                  type="date"
                  value={from}
                  onChange={(event) => {
                    setFrom(event.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <label className="newsFilterField">
                <div className="newsFilterLabel">{t("filters.to")}</div>
                <input
                  className="input"
                  type="date"
                  value={to}
                  onChange={(event) => {
                    setTo(event.target.value);
                    setPage(0);
                  }}
                />
              </label>
            </>
          ) : null}

          <div className="newsFilterActions">
            <button className="btn" type="button" onClick={() => void load()}>
              {t("actions.refresh")}
            </button>
          </div>
        </div>
      </div>

      {meta ? (
        <div className="card newsMetaCard">
          <span className="badge">{t("meta.mode")}: {meta.mode}</span>
          <span className="badge">{t("meta.cache")}: {meta.cache}</span>
          {meta.searchApplied && meta.searchQuery ? (
            <span className="badge">{t("meta.search")}: {meta.searchQuery}</span>
          ) : null}
          {meta.searchFallback ? (
            <span className="badge badgeWarn">{t("meta.searchFallback")}</span>
          ) : null}
          <span className="badge">
            {t("meta.fetchedAt")}: {new Date(meta.fetchedAt).toLocaleString(dateLocale)}
          </span>
          {meta.partial ? (
            <span className="badge badgeWarn">{t("meta.partial")}</span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="card newsErrorCard">{t("loadError")}: {error}</div>
      ) : null}

      <div className="card newsListCard">
        {loading ? (
          <div className="newsEmptyText">{t("loading")}</div>
        ) : items.length === 0 ? (
          <div className="newsEmptyText">{t("empty")}</div>
        ) : (
          <div className="newsList">
            {items.map((item) => (
              <article className="card newsItemCard" key={item.id}>
                <div className="newsItemContent">
                  <div className="newsItemHeader">
                    <span className={`badge ${item.feed === "crypto" ? "newsBadgeCrypto" : "newsBadgeGeneral"}`}>
                      {item.feed === "crypto" ? t("feed.crypto") : t("feed.general")}
                    </span>
                    {item.symbol ? <span className="badge">{item.symbol}</span> : null}
                    <span className="newsItemTime">
                      {new Date(item.publishedAt).toLocaleString(dateLocale)}
                    </span>
                  </div>
                  <a href={item.url} target="_blank" rel="noreferrer" className="newsItemTitle">
                    {item.title}
                  </a>
                  {item.site ? <div className="newsItemSite">{item.site}</div> : null}
                  {item.text ? <p className="newsItemText">{item.text}</p> : null}
                </div>
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.title} className="newsItemImage" loading="lazy" />
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

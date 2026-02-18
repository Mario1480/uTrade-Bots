import assert from "node:assert/strict";
import test from "node:test";
import { listNews } from "./index.js";

type FetchLike = typeof fetch;

function installFetchMock(handler: (url: URL) => Response | Promise<Response>): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    return handler(new URL(raw));
  }) as FetchLike;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function mockNewsResponse(items: Array<Record<string, unknown>>): Response {
  return new Response(JSON.stringify(items), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

test("mode=crypto with q uses search and sets search meta", { concurrency: false }, async () => {
  const prevApiKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = "test_key";
  const restoreFetch = installFetchMock((url) => {
    if (url.pathname === "/stable/search-crypto-news") {
      return mockNewsResponse([
        {
          title: "Bitcoin market update",
          url: "https://example.com/crypto/bitcoin",
          publishedDate: "2026-02-18T10:00:00Z",
          symbol: "BTC",
          text: "BTC rallies."
        }
      ]);
    }
    return new Response("not found", { status: 404 });
  });

  try {
    const result = await listNews({
      db: {},
      mode: "crypto",
      limit: 20,
      page: 0,
      q: "bitcoin",
      symbols: []
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.feed, "crypto");
    assert.equal(result.meta.searchApplied, true);
    assert.equal(result.meta.searchQuery, "bitcoin");
    assert.equal(result.meta.searchFallback, undefined);
  } finally {
    restoreFetch();
    process.env.FMP_API_KEY = prevApiKey;
  }
});

test("mode=all with q returns only crypto feed results", { concurrency: false }, async () => {
  const prevApiKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = "test_key";
  const calledPaths: string[] = [];
  const restoreFetch = installFetchMock((url) => {
    calledPaths.push(url.pathname);
    if (url.pathname === "/stable/search-crypto-news") {
      return mockNewsResponse([
        {
          title: "Solana update",
          url: "https://example.com/crypto/sol",
          publishedDate: "2026-02-18T11:00:00Z",
          symbol: "SOL"
        }
      ]);
    }
    if (url.pathname === "/stable/general-news") {
      return mockNewsResponse([
        {
          title: "General macro headline",
          url: "https://example.com/general/macro",
          publishedDate: "2026-02-18T09:00:00Z"
        }
      ]);
    }
    return new Response("not found", { status: 404 });
  });

  try {
    const result = await listNews({
      db: {},
      mode: "all",
      limit: 20,
      page: 0,
      q: "solana",
      symbols: []
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.feed, "crypto");
    assert.equal(calledPaths.includes("/stable/general-news"), false);
  } finally {
    restoreFetch();
    process.env.FMP_API_KEY = prevApiKey;
  }
});

test("q + symbols applies AND filtering", { concurrency: false }, async () => {
  const prevApiKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = "test_key";
  const restoreFetch = installFetchMock((url) => {
    if (url.pathname === "/stable/search-crypto-news") {
      return mockNewsResponse([
        {
          title: "Market setup BTC",
          url: "https://example.com/crypto/btc",
          publishedDate: "2026-02-18T12:00:00Z",
          symbol: "BTC",
          text: "Market setup"
        },
        {
          title: "Market setup ETH",
          url: "https://example.com/crypto/eth",
          publishedDate: "2026-02-18T12:01:00Z",
          symbol: "ETH",
          text: "Market setup"
        }
      ]);
    }
    return new Response("not found", { status: 404 });
  });

  try {
    const result = await listNews({
      db: {},
      mode: "crypto",
      limit: 20,
      page: 0,
      q: "market",
      symbols: ["BTC"]
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.symbol, "BTC");
  } finally {
    restoreFetch();
    process.env.FMP_API_KEY = prevApiKey;
  }
});

test("search failures fallback to crypto feed and set searchFallback", { concurrency: false }, async () => {
  const prevApiKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = "test_key";
  const restoreFetch = installFetchMock((url) => {
    if (url.pathname === "/stable/search-crypto-news") {
      return new Response("unavailable", { status: 503 });
    }
    if (url.pathname === "/stable/news/crypto" || url.pathname === "/api/v4/crypto_news") {
      return new Response("forbidden", { status: 403 });
    }
    if (url.pathname === "/stable/crypto-news") {
      return mockNewsResponse([
        {
          title: "BTC fallback feed",
          url: "https://example.com/crypto/fallback-btc",
          publishedDate: "2026-02-18T13:00:00Z",
          symbol: "BTC",
          text: "Fallback entry"
        }
      ]);
    }
    return new Response("not found", { status: 404 });
  });

  try {
    const result = await listNews({
      db: {},
      mode: "crypto",
      limit: 20,
      page: 0,
      q: "btc",
      symbols: []
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.meta.searchApplied, true);
    assert.equal(result.meta.searchFallback, true);
  } finally {
    restoreFetch();
    process.env.FMP_API_KEY = prevApiKey;
  }
});

test("cache key includes q so different queries do not collide", { concurrency: false }, async () => {
  const prevApiKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = "test_key";
  const restoreFetch = installFetchMock((url) => {
    if (url.pathname === "/stable/search-crypto-news") {
      const query = url.searchParams.get("query") ?? "unknown";
      return mockNewsResponse([
        {
          title: `Search result ${query}`,
          url: `https://example.com/crypto/${query}`,
          publishedDate: "2026-02-18T14:00:00Z",
          symbol: "BTC"
        }
      ]);
    }
    return new Response("not found", { status: 404 });
  });

  try {
    const alpha = await listNews({
      db: {},
      mode: "crypto",
      limit: 20,
      page: 0,
      q: "alpha",
      symbols: []
    });
    const beta = await listNews({
      db: {},
      mode: "crypto",
      limit: 20,
      page: 0,
      q: "beta",
      symbols: []
    });
    assert.equal(alpha.items[0]?.title.includes("alpha"), true);
    assert.equal(beta.items[0]?.title.includes("beta"), true);
    assert.equal(alpha.meta.cache, "miss");
    assert.equal(beta.meta.cache, "miss");
  } finally {
    restoreFetch();
    process.env.FMP_API_KEY = prevApiKey;
  }
});

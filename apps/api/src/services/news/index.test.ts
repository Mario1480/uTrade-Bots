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

test("mode=all with q searches crypto and general feeds", { concurrency: false }, async () => {
  const prevApiKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = "test_key";
  const calledPaths: string[] = [];
  const restoreFetch = installFetchMock((url) => {
    calledPaths.push(url.pathname);
    if (url.pathname === "/stable/search-crypto-news") {
      return mockNewsResponse([
        {
          title: "Macro BTC setup",
          url: "https://example.com/crypto/macro-btc",
          publishedDate: "2026-02-18T11:00:00Z",
          symbol: "BTC",
          text: "macro move"
        }
      ]);
    }
    if (url.pathname === "/stable/general-news") {
      return mockNewsResponse([
        {
          title: "Macro economy headline",
          url: "https://example.com/general/macro",
          publishedDate: "2026-02-18T10:00:00Z",
          site: "Reuters"
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
      page: 1,
      q: "macro",
      symbols: []
    });
    const feeds = new Set(result.items.map((item) => item.feed));
    assert.equal(result.items.length, 2);
    assert.equal(feeds.has("crypto"), true);
    assert.equal(feeds.has("general"), true);
    assert.equal(calledPaths.includes("/stable/general-news"), true);
    assert.equal(result.meta.searchApplied, true);
    assert.equal(result.meta.searchQuery, "macro");
  } finally {
    restoreFetch();
    process.env.FMP_API_KEY = prevApiKey;
  }
});

test("mode=general q matches title, text, and site", { concurrency: false }, async () => {
  const prevApiKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = "test_key";
  const restoreFetch = installFetchMock((url) => {
    if (url.pathname === "/stable/general-news") {
      return mockNewsResponse([
        {
          title: "Alpha outlook",
          url: "https://example.com/general/title",
          publishedDate: "2026-02-18T11:00:00Z",
          site: "Bloomberg",
          text: "market wrap"
        },
        {
          title: "Macro update",
          url: "https://example.com/general/text",
          publishedDate: "2026-02-18T10:59:00Z",
          site: "FT",
          text: "Alpha in text"
        },
        {
          title: "Rates update",
          url: "https://example.com/general/site",
          publishedDate: "2026-02-18T10:58:00Z",
          site: "AlphaWire",
          text: "neutral"
        },
        {
          title: "No match",
          url: "https://example.com/general/no-match",
          publishedDate: "2026-02-18T10:57:00Z",
          site: "Reuters",
          text: "neutral"
        }
      ]);
    }
    return new Response("not found", { status: 404 });
  });

  try {
    const result = await listNews({
      db: {},
      mode: "general",
      limit: 20,
      page: 1,
      q: "alpha",
      symbols: []
    });
    assert.equal(result.items.length, 3);
    assert.equal(result.items.every((item) => item.feed === "general"), true);
  } finally {
    restoreFetch();
    process.env.FMP_API_KEY = prevApiKey;
  }
});

test("fromTs/toTs filters news inclusively", { concurrency: false }, async () => {
  const prevApiKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = "test_key";
  const restoreFetch = installFetchMock((url) => {
    if (url.pathname === "/stable/crypto-news") {
      return mockNewsResponse([
        {
          title: "Boundary start",
          url: "https://example.com/crypto/start",
          publishedDate: "2026-02-18T10:00:00.000Z",
          symbol: "BTC"
        },
        {
          title: "Outside after",
          url: "https://example.com/crypto/outside",
          publishedDate: "2026-02-18T11:00:00.001Z",
          symbol: "BTC"
        }
      ]);
    }
    if (url.pathname === "/stable/general-news") {
      return mockNewsResponse([
        {
          title: "Boundary end",
          url: "https://example.com/general/end",
          publishedDate: "2026-02-18T11:00:00.000Z"
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
      page: 1,
      symbols: [],
      fromTs: "2026-02-18T10:00:00.000Z",
      toTs: "2026-02-18T11:00:00.000Z"
    });
    assert.equal(result.items.length, 2);
    assert.equal(result.items.some((item) => item.title === "Boundary start"), true);
    assert.equal(result.items.some((item) => item.title === "Boundary end"), true);
    assert.equal(result.items.some((item) => item.title === "Outside after"), false);
  } finally {
    restoreFetch();
    process.env.FMP_API_KEY = prevApiKey;
  }
});

test("all mode iterates provider pages to fill higher pages", { concurrency: false }, async () => {
  const prevApiKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = "test_key";
  const visitedCryptoPages: number[] = [];
  const visitedGeneralPages: number[] = [];

  const restoreFetch = installFetchMock((url) => {
    const providerPage = Number(url.searchParams.get("page") ?? "0");
    if (url.pathname === "/stable/crypto-news") {
      visitedCryptoPages.push(providerPage);
      return mockNewsResponse([
        {
          title: `C${providerPage}`,
          url: `https://example.com/crypto/${providerPage}`,
          publishedDate: `2026-02-18T1${2 - providerPage}:00:00Z`,
          symbol: "BTC"
        }
      ]);
    }
    if (url.pathname === "/stable/general-news") {
      visitedGeneralPages.push(providerPage);
      return mockNewsResponse([
        {
          title: `G${providerPage}`,
          url: `https://example.com/general/${providerPage}`,
          publishedDate: `2026-02-18T1${2 - providerPage}:30:00Z`
        }
      ]);
    }
    return new Response("not found", { status: 404 });
  });

  try {
    const result = await listNews({
      db: {},
      mode: "all",
      limit: 2,
      page: 2,
      symbols: []
    });

    assert.equal(result.items.length, 2);
    assert.equal(visitedCryptoPages.includes(1), true);
    assert.equal(visitedGeneralPages.includes(1), true);
    assert.equal(new Set(result.items.map((item) => item.title)).size, 2);
  } finally {
    restoreFetch();
    process.env.FMP_API_KEY = prevApiKey;
  }
});

test("q + symbols keeps symbol filtering on crypto only", { concurrency: false }, async () => {
  const prevApiKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = "test_key";
  const restoreFetch = installFetchMock((url) => {
    if (url.pathname === "/stable/search-crypto-news") {
      return mockNewsResponse([
        {
          title: "Market setup BTC",
          url: "https://example.com/crypto/btc-market",
          publishedDate: "2026-02-18T12:00:00Z",
          symbol: "BTC",
          text: "market"
        },
        {
          title: "Market setup ETH",
          url: "https://example.com/crypto/eth-market",
          publishedDate: "2026-02-18T11:59:00Z",
          symbol: "ETH",
          text: "market"
        }
      ]);
    }
    if (url.pathname === "/stable/general-news") {
      return mockNewsResponse([
        {
          title: "Market macro",
          url: "https://example.com/general/market",
          publishedDate: "2026-02-18T11:58:00Z",
          site: "Reuters"
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
      page: 1,
      q: "market",
      symbols: ["BTC"]
    });

    assert.equal(result.items.length, 2);
    assert.equal(result.items.some((item) => item.feed === "general"), true);
    const cryptoSymbols = result.items.filter((item) => item.feed === "crypto").map((item) => item.symbol);
    assert.deepEqual(cryptoSymbols, ["BTC"]);
  } finally {
    restoreFetch();
    process.env.FMP_API_KEY = prevApiKey;
  }
});

test("mode=all with q falls back to crypto feed when crypto search returns empty", { concurrency: false }, async () => {
  const prevApiKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = "test_key";
  const restoreFetch = installFetchMock((url) => {
    if (url.pathname === "/stable/search-crypto-news") {
      return mockNewsResponse([]);
    }
    if (url.pathname === "/stable/crypto-news") {
      return mockNewsResponse([
        {
          title: "Bitcoin breaks resistance",
          url: "https://example.com/crypto/bitcoin-breakout",
          publishedDate: "2026-02-18T12:00:00Z",
          symbol: "BTC",
          text: "bitcoin trend up"
        }
      ]);
    }
    if (url.pathname === "/stable/general-news") {
      return mockNewsResponse([
        {
          title: "General rates update",
          url: "https://example.com/general/rates",
          publishedDate: "2026-02-18T11:58:00Z",
          site: "Reuters"
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
      page: 1,
      q: "bitcoin",
      symbols: []
    });
    assert.equal(result.items.some((item) => item.feed === "crypto"), true);
    assert.equal(result.items.some((item) => item.title.includes("Bitcoin")), true);
  } finally {
    restoreFetch();
    process.env.FMP_API_KEY = prevApiKey;
  }
});

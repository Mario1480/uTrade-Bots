export type NewsFeed = "crypto" | "general";
export type NewsMode = "all" | NewsFeed;

export type NewsItemNormalized = {
  id: string;
  source: "fmp";
  feed: NewsFeed;
  title: string;
  url: string;
  site: string | null;
  publishedAt: Date;
  imageUrl: string | null;
  symbol: string | null;
  text: string | null;
};

export type NewsItemView = {
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

export type ListNewsParams = {
  db: any;
  mode: NewsMode;
  limit: number;
  page: number; // 1-based page index
  q?: string | null;
  symbols?: string[];
  from?: string | null;
  to?: string | null;
  fromTs?: string | null;
  toTs?: string | null;
};

export type ListNewsResult = {
  items: NewsItemView[];
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

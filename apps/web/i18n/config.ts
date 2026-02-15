export const LOCALES = ["en", "de"] as const;

export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";
export const LOCALE_COOKIE_NAME = "utrade_locale";

export function isLocale(value: string | null | undefined): value is AppLocale {
  if (!value) return false;
  return (LOCALES as readonly string[]).includes(value);
}

export function extractLocaleFromPathname(pathname: string): {
  locale: AppLocale | null;
  pathnameWithoutLocale: string;
} {
  const cleaned = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length === 0) {
    return { locale: null, pathnameWithoutLocale: "/" };
  }

  const maybeLocale = parts[0] ?? null;
  if (!isLocale(maybeLocale)) {
    return { locale: null, pathnameWithoutLocale: cleaned };
  }

  const rest = parts.slice(1).join("/");
  return {
    locale: maybeLocale,
    pathnameWithoutLocale: rest ? `/${rest}` : "/"
  };
}

export function withLocalePath(pathname: string, locale: AppLocale): string {
  const { pathnameWithoutLocale } = extractLocaleFromPathname(pathname);
  if (pathnameWithoutLocale === "/") {
    return `/${locale}`;
  }
  return `/${locale}${pathnameWithoutLocale}`;
}

export function detectLocaleFromAcceptLanguage(header: string | null | undefined): AppLocale | null {
  if (!header || typeof header !== "string") return null;
  const normalized = header.toLowerCase();
  if (normalized.includes("de")) return "de";
  if (normalized.includes("en")) return "en";
  return null;
}

export function resolvePreferredLocale(params: {
  cookieLocale?: string | null;
  acceptLanguage?: string | null;
}): AppLocale {
  if (isLocale(params.cookieLocale)) return params.cookieLocale;
  const fromHeader = detectLocaleFromAcceptLanguage(params.acceptLanguage);
  return fromHeader ?? DEFAULT_LOCALE;
}

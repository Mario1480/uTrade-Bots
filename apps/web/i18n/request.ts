import { cookies, headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  isLocale,
  type AppLocale
} from "./config";

export async function resolveRequestLocale(): Promise<AppLocale> {
  const headerStore = await headers();
  const cookieStore = await cookies();

  const fromHeader = headerStore.get("x-utrade-locale");
  if (isLocale(fromHeader)) return fromHeader;

  const fromCookie = cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? null;
  if (isLocale(fromCookie)) return fromCookie;

  return DEFAULT_LOCALE;
}

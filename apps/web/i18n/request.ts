import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  isLocale,
  type AppLocale
} from "./config";
import { getMessages } from "./messages";

export async function resolveRequestLocale(): Promise<AppLocale> {
  const headerStore = await headers();
  const cookieStore = await cookies();

  const fromHeader = headerStore.get("x-utrade-locale");
  if (isLocale(fromHeader)) return fromHeader;

  const fromCookie = cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? null;
  if (isLocale(fromCookie)) return fromCookie;

  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveRequestLocale();
  return {
    locale,
    messages: getMessages(locale)
  };
});

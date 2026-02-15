import enCommon from "../messages/en/common.json";
import enNav from "../messages/en/nav.json";
import enAuth from "../messages/en/auth.json";
import enDashboard from "../messages/en/dashboard.json";
import enSystem from "../messages/en/system.json";
import deCommon from "../messages/de/common.json";
import deNav from "../messages/de/nav.json";
import deAuth from "../messages/de/auth.json";
import deDashboard from "../messages/de/dashboard.json";
import deSystem from "../messages/de/system.json";
import type { AppLocale } from "./config";

export type I18nMessages = {
  common: typeof enCommon;
  nav: typeof enNav;
  auth: typeof enAuth;
  dashboard: typeof enDashboard;
  system: typeof enSystem;
};

const messagesByLocale: Record<AppLocale, I18nMessages> = {
  en: {
    common: enCommon,
    nav: enNav,
    auth: enAuth,
    dashboard: enDashboard,
    system: enSystem
  },
  de: {
    common: deCommon,
    nav: deNav,
    auth: deAuth,
    dashboard: deDashboard,
    system: deSystem
  }
};

export function getMessages(locale: AppLocale): I18nMessages {
  return messagesByLocale[locale];
}

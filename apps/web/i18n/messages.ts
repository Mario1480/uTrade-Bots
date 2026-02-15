import enCommon from "../messages/en/common.json";
import enNav from "../messages/en/nav.json";
import enAuth from "../messages/en/auth.json";
import enDashboard from "../messages/en/dashboard.json";
import enSystem from "../messages/en/system.json";
import enAdmin from "../messages/en/admin.json";
import enHelp from "../messages/en/help.json";
import enSettings from "../messages/en/settings.json";
import enPredictions from "../messages/en/predictions.json";
import deCommon from "../messages/de/common.json";
import deNav from "../messages/de/nav.json";
import deAuth from "../messages/de/auth.json";
import deDashboard from "../messages/de/dashboard.json";
import deSystem from "../messages/de/system.json";
import deAdmin from "../messages/de/admin.json";
import deHelp from "../messages/de/help.json";
import deSettings from "../messages/de/settings.json";
import dePredictions from "../messages/de/predictions.json";
import type { AppLocale } from "./config";

export type I18nMessages = {
  common: typeof enCommon;
  nav: typeof enNav;
  auth: typeof enAuth;
  dashboard: typeof enDashboard;
  system: typeof enSystem;
  admin: typeof enAdmin;
  help: typeof enHelp;
  settings: typeof enSettings;
  predictions: typeof enPredictions;
};

const messagesByLocale: Record<AppLocale, I18nMessages> = {
  en: {
    common: enCommon,
    nav: enNav,
    auth: enAuth,
    dashboard: enDashboard,
    system: enSystem,
    admin: enAdmin,
    help: enHelp,
    settings: enSettings,
    predictions: enPredictions
  },
  de: {
    common: deCommon,
    nav: deNav,
    auth: deAuth,
    dashboard: deDashboard,
    system: deSystem,
    admin: deAdmin,
    help: deHelp,
    settings: deSettings,
    predictions: dePredictions
  }
};

export function getMessages(locale: AppLocale): I18nMessages {
  return messagesByLocale[locale];
}

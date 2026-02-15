import { NextIntlClientProvider } from "next-intl";
import AppHeader from "./components/AppHeader";
import SystemBanner from "./components/SystemBanner";
import { resolveRequestLocale } from "../i18n/request";
import { getMessages } from "../i18n/messages";
import "./globals.css";

export const metadata = { title: "uTrade Panel" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await resolveRequestLocale();
  const messages = getMessages(locale);

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AppHeader />
          <SystemBanner />
          <main className="container appMain">{children}</main>
          <footer className="appFooter">
            <div className="container appFooterInner">
              <div className="appFooterCopy">© 2026 uTrade</div>
              <div className="appFooterLinks">
                <a href="https://utrade.vip" aria-label="uTrade Website">utrade.vip</a>
                <a href="https://utrade.vip/privacy" aria-label={messages.common.footer.privacy}>
                  {messages.common.footer.privacy}
                </a>
                <a href="https://utrade.vip/terms" aria-label={messages.common.footer.terms}>
                  {messages.common.footer.terms}
                </a>
                <a href="mailto:support@utrade.vip" aria-label="Support email">support@utrade.vip</a>
              </div>
            </div>
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

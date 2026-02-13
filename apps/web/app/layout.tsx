import AppHeader from "./components/AppHeader";
import SystemBanner from "./components/SystemBanner";
import "./globals.css";

export const metadata = { title: "uTrade Panel" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        <AppHeader />
        <SystemBanner />
        <main className="container appMain">{children}</main>
        <footer className="appFooter">
          <div className="container appFooterInner">
            <div className="appFooterCopy">© 2026 uTrade</div>
            <div className="appFooterLinks">
              <a href="https://utrade.vip" aria-label="uTrade Website">utrade.vip</a>
              <a href="https://utrade.vip/privacy" aria-label="Privacy Policy">Privacy Policy</a>
              <a href="https://utrade.vip/terms" aria-label="Terms of Service">Terms of Service</a>
              <a href="mailto:support@utrade.vip" aria-label="Support email">support@utrade.vip</a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}

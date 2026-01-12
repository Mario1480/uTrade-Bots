import "./globals.css";

export const metadata = { title: "Market Maker UI" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        <div className="container">
          <h1 style={{ marginTop: 0 }}>Market Maker</h1>
          {children}
        </div>
      </body>
    </html>
  );
}

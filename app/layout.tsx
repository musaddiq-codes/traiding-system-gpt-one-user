import "./globals.css";
import { TradingProvider } from "./context/TradingContext";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <TradingProvider>
          {children}
        </TradingProvider>
      </body>
    </html>
  );
}
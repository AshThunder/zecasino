import type { Metadata, Viewport } from "next";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/700.css";
import "@fontsource/cormorant-garamond/600-italic.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";
import { Header } from "@/components/Header";


export const metadata: Metadata = { title: "Zecasino · Play in the shielded pool", description: "A private casino on Zcash. Shielded deposits, provably fair games, no accounts." };
export const viewport: Viewport = { themeColor: "#0B0B0C" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        <main>{children}</main>
        <footer className="ftr">
          <span>Zecasino runs on Zcash shielded pools (Orchard / Ironwood). Testnet TAZ only: a technology demo, not real-money gambling.</span>
          <span>Not affiliated with ZKasino.</span>
        </footer>
      </body>
    </html>
  );
}

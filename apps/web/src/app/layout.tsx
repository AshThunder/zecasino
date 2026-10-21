import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";

const display = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display" });
const body = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = { title: "Zecasino · Play in the shielded pool", description: "A private casino on Zcash. Shielded deposits, provably fair games, no accounts." };
export const viewport: Viewport = { themeColor: "#0B0B0C" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
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

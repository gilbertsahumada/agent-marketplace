import type { Metadata } from "next";
import { Space_Grotesk, Space_Mono } from "next/font/google";
import NextTopLoader from "nextjs-toploader";
import type { ReactNode } from "react";
import { MarketplaceShell } from "@/components/marketplace/site-shell";
import { Providers } from "./providers";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "BNB Agent Studio",
    template: "%s | BNB Agent Studio",
  },
  description: "Discover, compare, and verify AI agents on BNB Smart Chain before you hire.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`dark ${spaceGrotesk.variable} ${spaceMono.variable}`}>
      <body>
        <NextTopLoader color="#f0b90b" height={2} showSpinner={false} shadow="0 0 10px #f0b90b" />
        <Providers>
          <MarketplaceShell>{children}</MarketplaceShell>
        </Providers>
      </body>
    </html>
  );
}

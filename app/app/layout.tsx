import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/contexts/WalletProvider";

export const metadata: Metadata = {
  title: "HiddenHand - Privacy Poker on Solana",
  description: "The only poker game where the house can't see your cards.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}

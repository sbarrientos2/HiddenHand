"use client";

import { FC, ReactNode, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";

// Import wallet adapter styles
import "@solana/wallet-adapter-react-ui/styles.css";

// Network configuration - change this to switch between localnet and devnet
// For development: "localnet" (requires solana-test-validator running)
// For demo/production: "devnet"
export type Network = "localnet" | "devnet";
export const NETWORK: Network = "devnet";

// Base layer endpoints (Solana)
const ENDPOINTS: Record<Network, string> = {
  localnet: "http://127.0.0.1:8899",
  devnet: clusterApiUrl("devnet"),
};

// MagicBlock Ephemeral Rollup endpoints (for fast transactions)
const ER_ENDPOINTS: Record<Network, { http: string; ws: string }> = {
  localnet: {
    http: "http://localhost:7799",
    ws: "ws://localhost:7800",
  },
  devnet: {
    http: "https://devnet.magicblock.app/",
    ws: "wss://devnet.magicblock.app/",
  },
};

// Export endpoints for use in hooks
export const getEndpoints = () => ({
  baseLayer: ENDPOINTS[NETWORK],
  ephemeralRollup: ER_ENDPOINTS[NETWORK],
});

interface Props {
  children: ReactNode;
}

export const WalletProvider: FC<Props> = ({ children }) => {
  const endpoint = useMemo(() => ENDPOINTS[NETWORK], []);

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
};

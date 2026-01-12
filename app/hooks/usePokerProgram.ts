"use client";

import { useMemo } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { Program, AnchorProvider, Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/program";
import idl from "@/lib/idl/hiddenhand.json";

// Type for the IDL
export type HiddenhandIDL = typeof idl;

export interface UsePokerProgramResult {
  program: Program<Idl> | null;
  provider: AnchorProvider | null;
  connected: boolean;
  publicKey: PublicKey | null;
}

/**
 * Hook to get the Anchor program instance for HiddenHand
 * Returns null if wallet is not connected
 */
export function usePokerProgram(): UsePokerProgramResult {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  const provider = useMemo(() => {
    if (!wallet) return null;
    return new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
  }, [connection, wallet]);

  const program = useMemo(() => {
    if (!provider) return null;
    return new Program(idl as Idl, provider);
  }, [provider]);

  return {
    program,
    provider,
    connected: !!wallet,
    publicKey: wallet?.publicKey ?? null,
  };
}

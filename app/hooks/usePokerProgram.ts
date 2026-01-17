"use client";

import { useMemo } from "react";
import { useConnection, useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { Program, AnchorProvider, Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/program";
import { getEndpoints } from "@/contexts/WalletProvider";
import idl from "@/lib/idl/hiddenhand.json";

// Type for the IDL
export type HiddenhandIDL = typeof idl;

export interface UsePokerProgramResult {
  // Base layer (Solana devnet/localnet)
  program: Program<Idl> | null;
  provider: AnchorProvider | null;

  // Ephemeral Rollup (MagicBlock)
  erProgram: Program<Idl> | null;
  erProvider: AnchorProvider | null;
  erConnection: Connection | null;

  // Common
  connected: boolean;
  publicKey: PublicKey | null;
  signMessage: ((message: Uint8Array) => Promise<Uint8Array>) | undefined;
}

/**
 * Hook to get the Anchor program instances for HiddenHand
 * Provides both base layer and Ephemeral Rollup connections
 *
 * Use base layer (program/provider) for:
 * - createTable, joinTable, leaveTable
 * - delegateSeat, undelegateSeat
 * - requestShuffle (initiates VRF)
 *
 * Use Ephemeral Rollup (erProgram/erProvider) for:
 * - playerAction (fast gameplay)
 * - dealCardsVrf (after VRF shuffle)
 * - showdown
 */
export function usePokerProgram(): UsePokerProgramResult {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const { signMessage } = useWallet();
  const endpoints = getEndpoints();

  // Base layer provider (Solana devnet/localnet)
  const provider = useMemo(() => {
    if (!wallet) return null;
    return new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
  }, [connection, wallet]);

  // Base layer program
  const program = useMemo(() => {
    if (!provider) return null;
    return new Program(idl as Idl, provider);
  }, [provider]);

  // Ephemeral Rollup connection
  const erConnection = useMemo(() => {
    return new Connection(endpoints.ephemeralRollup.http, {
      commitment: "confirmed",
      wsEndpoint: endpoints.ephemeralRollup.ws,
    });
  }, [endpoints.ephemeralRollup]);

  // Ephemeral Rollup provider
  const erProvider = useMemo(() => {
    if (!wallet) return null;
    return new AnchorProvider(erConnection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
  }, [erConnection, wallet]);

  // Ephemeral Rollup program
  const erProgram = useMemo(() => {
    if (!erProvider) return null;
    return new Program(idl as Idl, erProvider);
  }, [erProvider]);

  return {
    // Base layer
    program,
    provider,

    // Ephemeral Rollup
    erProgram,
    erProvider,
    erConnection,

    // Common
    connected: !!wallet,
    publicKey: wallet?.publicKey ?? null,
    signMessage,
  };
}

import { Connection, PublicKey } from "@solana/web3.js";
import { getEndpoints, NETWORK } from "@/contexts/WalletProvider";

// MagicBlock VRF Program Constants
// From ephemeral-vrf-sdk v0.2.1
export const VRF_PROGRAM_ID = new PublicKey(
  "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
);

export const DEFAULT_QUEUE = new PublicKey(
  "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh"
);

export const VRF_PROGRAM_IDENTITY = new PublicKey(
  "9irBy75QS2BN81FUgXuHcjqceJJRuc9oDkAe8TKVvvAw"
);

// Ephemeral Rollup delegation program
export const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
);

// MagicBlock delegation record seed
const DELEGATION_RECORD_SEED = "delegation";

/**
 * Derive the delegation record PDA for a delegated account
 * This PDA exists only when the account is delegated
 */
export function getDelegationRecordPDA(delegatedAccount: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(DELEGATION_RECORD_SEED), delegatedAccount.toBuffer()],
    DELEGATION_PROGRAM_ID
  );
}

/**
 * Check if an account is delegated to the Ephemeral Rollup
 * by checking if the delegation record PDA exists
 */
export async function isAccountDelegated(
  connection: Connection,
  accountPubkey: PublicKey
): Promise<boolean> {
  try {
    const [delegationRecordPDA] = getDelegationRecordPDA(accountPubkey);
    const account = await connection.getAccountInfo(delegationRecordPDA);
    return account !== null;
  } catch (e) {
    console.warn("Error checking delegation status:", e);
    return false;
  }
}

/**
 * Check if an account is delegated by checking its owner
 * Delegated accounts are owned by the Delegation Program
 */
export async function isAccountDelegatedByOwner(
  connection: Connection,
  accountPubkey: PublicKey
): Promise<boolean> {
  try {
    const account = await connection.getAccountInfo(accountPubkey);
    if (!account) return false;
    return account.owner.equals(DELEGATION_PROGRAM_ID);
  } catch (e) {
    console.warn("Error checking delegation by owner:", e);
    return false;
  }
}

// MagicBlock ER connection configuration
export interface MagicBlockConnections {
  baseLayer: Connection;
  ephemeralRollup: Connection;
  erWsEndpoint: string;
}

/**
 * Create connections for both base layer and Ephemeral Rollup
 */
export function createMagicBlockConnections(): MagicBlockConnections {
  const endpoints = getEndpoints();

  return {
    baseLayer: new Connection(endpoints.baseLayer, "confirmed"),
    ephemeralRollup: new Connection(endpoints.ephemeralRollup.http, "confirmed"),
    erWsEndpoint: endpoints.ephemeralRollup.ws,
  };
}

/**
 * Get the appropriate connection based on whether we're in ER mode
 */
export function getConnection(
  connections: MagicBlockConnections,
  useEphemeralRollup: boolean
): Connection {
  return useEphemeralRollup ? connections.ephemeralRollup : connections.baseLayer;
}

/**
 * Check if we're on a network that supports MagicBlock
 */
export function isMagicBlockSupported(): boolean {
  // MagicBlock is available on devnet and localnet (with local ER validator)
  return NETWORK === "devnet" || NETWORK === "localnet";
}

/**
 * Poll for VRF seed received (VRF callback completion)
 * Returns true when VRF seed is received, false on timeout
 *
 * Note: The VRF callback sets seed_received=true, NOT is_shuffled.
 * The actual shuffle happens later in deal_cards_vrf on the ER.
 */
export async function waitForShuffle(
  connection: Connection,
  deckPDA: PublicKey,
  timeoutMs: number = 30000,
  pollIntervalMs: number = 1000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const accountInfo = await connection.getAccountInfo(deckPDA);
      if (accountInfo && accountInfo.data.length > 0) {
        // DeckState layout:
        // 8 bytes discriminator
        // 32 bytes hand pubkey
        // 52 * 16 = 832 bytes cards array
        // 1 byte deal_index
        // 1 byte is_shuffled
        // 32 bytes vrf_seed
        // 1 byte seed_received <-- VRF callback sets THIS
        // 1 byte bump
        // seed_received is at offset 8 + 32 + 832 + 1 + 1 + 32 = 906
        const SEED_RECEIVED_OFFSET = 8 + 32 + (52 * 16) + 1 + 1 + 32;
        const seedReceived = accountInfo.data[SEED_RECEIVED_OFFSET] === 1;

        if (seedReceived) {
          return true;
        }
      }
    } catch (e) {
      console.warn("Error polling deck state:", e);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return false;
}

/**
 * Subscribe to deck state changes for real-time VRF seed detection
 */
export function subscribeToShuffleCompletion(
  connection: Connection,
  deckPDA: PublicKey,
  onShuffled: () => void
): number {
  const SEED_RECEIVED_OFFSET = 8 + 32 + (52 * 16) + 1 + 1 + 32;

  return connection.onAccountChange(deckPDA, (accountInfo) => {
    if (accountInfo.data.length > SEED_RECEIVED_OFFSET) {
      const seedReceived = accountInfo.data[SEED_RECEIVED_OFFSET] === 1;
      if (seedReceived) {
        onShuffled();
      }
    }
  });
}

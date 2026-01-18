import { Connection, PublicKey } from "@solana/web3.js";

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

/**
 * Poll for VRF shuffle completion (atomic shuffle + encrypt)
 * Returns true when is_shuffled is set, false on timeout
 *
 * Note: With Modified Option B, the VRF callback atomically shuffles
 * the deck AND encrypts cards in a single transaction. is_shuffled=true
 * means everything is done.
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
        // DeckState layout (Modified Option B - no vrf_seed stored):
        // 8 bytes discriminator
        // 32 bytes hand pubkey
        // 52 * 16 = 832 bytes cards array
        // 1 byte deal_index
        // 1 byte is_shuffled <-- VRF callback sets THIS when complete
        // 1 byte bump
        // 33 bytes _reserved
        // is_shuffled is at offset 8 + 32 + 832 + 1 = 873
        const IS_SHUFFLED_OFFSET = 8 + 32 + (52 * 16) + 1;
        const isShuffled = accountInfo.data[IS_SHUFFLED_OFFSET] === 1;

        if (isShuffled) {
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
 * Subscribe to deck state changes for real-time shuffle completion detection
 */
export function subscribeToShuffleCompletion(
  connection: Connection,
  deckPDA: PublicKey,
  onShuffled: () => void
): number {
  // is_shuffled is at offset 8 + 32 + 832 + 1 = 873
  const IS_SHUFFLED_OFFSET = 8 + 32 + (52 * 16) + 1;

  return connection.onAccountChange(deckPDA, (accountInfo) => {
    if (accountInfo.data.length > IS_SHUFFLED_OFFSET) {
      const isShuffled = accountInfo.data[IS_SHUFFLED_OFFSET] === 1;
      if (isShuffled) {
        onShuffled();
      }
    }
  });
}

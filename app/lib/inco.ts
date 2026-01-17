/**
 * Inco Lightning FHE Client-Side Decryption
 *
 * This module provides utilities for decrypting Inco-encrypted hole cards
 * on the client side. Players can only decrypt cards they've been granted
 * allowances for (via grant_card_allowance instruction).
 *
 * Flow:
 * 1. Cards are encrypted on-chain via encrypt_hole_cards
 * 2. Player is granted allowance via grant_card_allowance
 * 3. Client calls decryptCards() with wallet signing
 * 4. Inco covalidators verify allowance and decrypt in TEE
 * 5. Plaintext card values (0-51) returned to client
 */

import { PublicKey } from "@solana/web3.js";

// Inco Program ID
export const INCO_PROGRAM_ID = new PublicKey(
  "5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj"
);

// Card decoding utilities
const SUITS = ["Hearts", "Diamonds", "Clubs", "Spades"];
const SUIT_SYMBOLS = ["♥", "♦", "♣", "♠"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

export interface DecodedCard {
  value: number;
  suit: string;
  suitSymbol: string;
  rank: string;
  display: string; // e.g., "A♠"
}

/**
 * Decode a plaintext card value (0-51) to suit and rank
 */
export function decodeCard(cardValue: number): DecodedCard {
  if (cardValue < 0 || cardValue > 51) {
    throw new Error(`Invalid card value: ${cardValue}`);
  }

  const suitIndex = Math.floor(cardValue / 13);
  const rankIndex = cardValue % 13;

  return {
    value: cardValue,
    suit: SUITS[suitIndex],
    suitSymbol: SUIT_SYMBOLS[suitIndex],
    rank: RANKS[rankIndex],
    display: `${RANKS[rankIndex]}${SUIT_SYMBOLS[suitIndex]}`,
  };
}

/**
 * Check if a value is an encrypted handle (> 51) vs plaintext card (0-51)
 */
export function isEncryptedHandle(value: bigint | number): boolean {
  const numValue = typeof value === "bigint" ? Number(value) : value;
  return numValue > 51;
}

/**
 * Convert a BigInt handle to the format Inco SDK expects
 */
export function handleToBuffer(handle: bigint): Buffer {
  const buf = Buffer.alloc(16);
  let h = handle;
  for (let i = 0; i < 16; i++) {
    buf[i] = Number(h & BigInt(0xff));
    h >>= BigInt(8);
  }
  return buf;
}

/**
 * Wallet signing interface for Inco decryption
 */
export interface WalletSigner {
  publicKey: PublicKey;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}

/**
 * Convert a BigInt handle to string format for Inco SDK
 * The SDK internally does BigInt(handle), so we pass decimal strings
 */
export function handleToString(handle: bigint): string {
  return handle.toString(10); // Decimal string, not hex
}

/**
 * Decrypt encrypted card handles using Inco SDK
 *
 * This requires the player to have been granted allowances for the cards.
 * The wallet must sign to prove ownership.
 *
 * @param handles - Array of encrypted u128 handles (as bigints)
 * @param wallet - Wallet with publicKey and signMessage
 * @returns Array of decrypted card values (0-51)
 */
export async function decryptCards(
  handles: bigint[],
  wallet: WalletSigner
): Promise<number[]> {
  // Dynamic import to avoid SSR issues
  const { decrypt } = await import("@inco/solana-sdk");

  // Convert handles to decimal strings (Inco SDK does BigInt(handle) internally)
  const handleStrings = handles.map((h) => handleToString(h));

  try {
    // Call Inco's decrypt with wallet signing for authentication
    const result = await decrypt(handleStrings, {
      address: wallet.publicKey,
      signMessage: wallet.signMessage,
    });

    // Extract plaintext values - they come as DECIMAL strings (not hex!)
    const plaintexts = result.plaintexts.map((pt: string) => {
      // Parse as decimal (base 10), NOT hex
      const value = parseInt(pt, 10);
      // Card value should be 0-51
      if (value < 0 || value > 51) {
        console.warn(`[Inco] Unexpected card value: ${value} from "${pt}"`);
      }
      return value;
    });

    return plaintexts;
  } catch (error) {
    console.error("Inco decryption failed:", error);
    throw new Error(
      `Failed to decrypt cards: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Decrypt and decode cards in one step
 *
 * @param handles - Array of encrypted u128 handles
 * @param wallet - Wallet with signing capability
 * @returns Array of decoded cards with suit/rank info
 */
export async function decryptAndDecodeCards(
  handles: bigint[],
  wallet: WalletSigner
): Promise<DecodedCard[]> {
  const plaintexts = await decryptCards(handles, wallet);
  return plaintexts.map(decodeCard);
}

/**
 * Try to display a card value - either decrypt if encrypted or decode if plaintext
 *
 * @param value - Card value (could be plaintext 0-51 or encrypted handle)
 * @param wallet - Optional wallet for decryption (required if encrypted)
 * @returns Decoded card or null if can't decrypt
 */
export async function tryDisplayCard(
  value: bigint | number,
  wallet?: WalletSigner
): Promise<DecodedCard | null> {
  const numValue = typeof value === "bigint" ? value : BigInt(value);

  // If it's a plaintext value, just decode it
  if (!isEncryptedHandle(numValue)) {
    return decodeCard(Number(numValue));
  }

  // If encrypted and we have a wallet, try to decrypt
  if (wallet) {
    try {
      const [decrypted] = await decryptAndDecodeCards([numValue], wallet);
      return decrypted;
    } catch (error) {
      console.warn("Failed to decrypt card:", error);
      return null;
    }
  }

  // Encrypted but no wallet - can't display
  return null;
}

/**
 * Derive allowance PDA for an encrypted handle
 * Seeds: [handle_le_bytes, player_pubkey]
 */
export function getAllowancePDA(
  handle: bigint,
  playerPubkey: PublicKey
): [PublicKey, number] {
  const handleBuf = handleToBuffer(handle);
  return PublicKey.findProgramAddressSync(
    [handleBuf, playerPubkey.toBuffer()],
    INCO_PROGRAM_ID
  );
}

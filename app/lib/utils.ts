import { LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * Convert lamports to SOL
 */
export function lamportsToSol(lamports: number | bigint): number {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

/**
 * Convert SOL to lamports
 */
export function solToLamports(sol: number): number {
  return Math.floor(sol * LAMPORTS_PER_SOL);
}

/**
 * Format SOL amount for display (e.g., "1.5 SOL")
 */
export function formatSol(lamports: number | bigint, decimals: number = 2): string {
  return `${lamportsToSol(lamports).toFixed(decimals)} SOL`;
}

// Card suits and ranks
const SUITS = ["Hearts", "Diamonds", "Clubs", "Spades"] as const;
const SUIT_SYMBOLS = ["♥", "♦", "♣", "♠"] as const;
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;

export type Suit = (typeof SUITS)[number];
export type SuitSymbol = (typeof SUIT_SYMBOLS)[number];
export type Rank = (typeof RANKS)[number];

export interface DecodedCard {
  suit: Suit;
  suitSymbol: SuitSymbol;
  rank: Rank;
  suitIndex: number;
  rankIndex: number;
  isRed: boolean;
}

/**
 * Decode a card value (0-51) to suit and rank
 * Card encoding: suit = card / 13, rank = card % 13
 * - Suit: 0=Hearts, 1=Diamonds, 2=Clubs, 3=Spades
 * - Rank: 0=2, 1=3, ..., 8=10, 9=J, 10=Q, 11=K, 12=A
 */
export function decodeCard(card: number): DecodedCard | null {
  if (card < 0 || card > 51 || card === 255) {
    return null; // Invalid or hidden card
  }

  const suitIndex = Math.floor(card / 13);
  const rankIndex = card % 13;

  return {
    suit: SUITS[suitIndex],
    suitSymbol: SUIT_SYMBOLS[suitIndex],
    rank: RANKS[rankIndex],
    suitIndex,
    rankIndex,
    isRed: suitIndex < 2, // Hearts and Diamonds are red
  };
}

/**
 * Encode suit and rank indices back to card value
 */
export function encodeCard(suitIndex: number, rankIndex: number): number {
  return suitIndex * 13 + rankIndex;
}

/**
 * Format a card for display (e.g., "A♠", "10♥")
 */
export function formatCard(card: number): string {
  const decoded = decodeCard(card);
  if (!decoded) return "??";
  return `${decoded.rank}${decoded.suitSymbol}`;
}

/**
 * Truncate a wallet address for display
 */
export function formatAddress(address: string, chars: number = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Map PlayerStatus enum to string
 */
export function mapPlayerStatus(
  status: { sitting?: object; playing?: object; folded?: object; allIn?: object }
): "sitting" | "playing" | "folded" | "allin" | "empty" {
  if ("sitting" in status) return "sitting";
  if ("playing" in status) return "playing";
  if ("folded" in status) return "folded";
  if ("allIn" in status) return "allin";
  return "empty";
}

/**
 * Map GamePhase enum to string
 */
export function mapGamePhase(
  phase: { dealing?: object; preFlop?: object; flop?: object; turn?: object; river?: object; showdown?: object; settled?: object }
): "Dealing" | "PreFlop" | "Flop" | "Turn" | "River" | "Showdown" | "Settled" {
  if ("dealing" in phase) return "Dealing";
  if ("preFlop" in phase) return "PreFlop";
  if ("flop" in phase) return "Flop";
  if ("turn" in phase) return "Turn";
  if ("river" in phase) return "River";
  if ("showdown" in phase) return "Showdown";
  if ("settled" in phase) return "Settled";
  return "Settled";
}

/**
 * Map TableStatus enum to string
 */
export function mapTableStatus(
  status: { waiting?: object; playing?: object; closed?: object }
): "Waiting" | "Playing" | "Closed" {
  if ("waiting" in status) return "Waiting";
  if ("playing" in status) return "Playing";
  if ("closed" in status) return "Closed";
  return "Waiting";
}

/**
 * Check if a seat is occupied using bitmap
 */
export function isSeatOccupied(occupiedSeats: number, seatIndex: number): boolean {
  return (occupiedSeats & (1 << seatIndex)) !== 0;
}

/**
 * Get list of occupied seat indices from bitmap
 */
export function getOccupiedSeats(occupiedSeats: number, maxSeats: number = 6): number[] {
  const seats: number[] = [];
  for (let i = 0; i < maxSeats; i++) {
    if (isSeatOccupied(occupiedSeats, i)) {
      seats.push(i);
    }
  }
  return seats;
}

/**
 * Check if a player is active using bitmap
 */
export function isPlayerActive(activePlayers: number, seatIndex: number): boolean {
  return (activePlayers & (1 << seatIndex)) !== 0;
}

/**
 * Parse Anchor/Program errors into user-friendly messages
 */
export function parseAnchorError(error: unknown, context?: {
  minBuyIn?: number;
  maxBuyIn?: number;
}): string {
  const errorStr = error instanceof Error ? error.message : String(error);

  // Map error codes to user-friendly messages
  const errorMappings: Record<string, string | ((ctx?: typeof context) => string)> = {
    "InvalidBuyIn": (ctx) => {
      if (ctx?.minBuyIn && ctx?.maxBuyIn) {
        return `Buy-in must be between ${formatSol(ctx.minBuyIn)} and ${formatSol(ctx.maxBuyIn)}`;
      }
      return "Buy-in amount is outside the allowed range for this table";
    },
    "TableFull": "This table is full. Please try another table.",
    "NotEnoughPlayers": "Need at least 2 players to start a hand.",
    "PlayerNotAtTable": "You are not seated at this table.",
    "PlayerAlreadyAtTable": "You are already seated at this table.",
    "InvalidSeatIndex": "Invalid seat selection.",
    "SeatOccupied": "This seat is already taken. Please choose another.",
    "SeatEmpty": "This seat is empty.",
    "NotPlayersTurn": "It's not your turn to act.",
    "InvalidAction": "This action is not valid right now.",
    "InsufficientChips": "You don't have enough chips for this action.",
    "HandNotInProgress": "No hand is currently in progress.",
    "HandAlreadyInProgress": "A hand is already in progress.",
    "CannotFold": "You cannot fold right now.",
    "CannotCheck": "You cannot check - there's a bet to call.",
    "RaiseTooSmall": "Raise amount is too small.",
    "BettingRoundNotComplete": "The betting round is not complete yet.",
    "InvalidPhase": "This action is not valid in the current game phase.",
    "ActionTimeout": "Action timed out.",
    "UnauthorizedAuthority": "Only the table creator can perform this action.",
    "ShowdownRequiresPlayers": "Showdown requires at least 2 active players.",
    "InvalidCardIndex": "Invalid card.",
    "DeckAlreadyShuffled": "Cards have already been shuffled.",
    "DeckNotShuffled": "Cards have not been shuffled yet.",
    "ActionNotTimedOut": "Player hasn't timed out yet - wait 60 seconds.",
    "CardsNotDealt": "Cards have not been dealt yet.",
    "AllCardsRevealed": "All community cards are already revealed.",
    "PlayerFolded": "You have already folded.",
    "PlayerAlreadyAllIn": "You are already all-in.",
    "TableNotWaiting": "Table is not in waiting state.",
    "CannotLeaveDuringHand": "You cannot leave during an active hand.",
    "Overflow": "Transaction calculation error.",
    "DuplicateAccount": "Duplicate account error.",
    "InvalidRemainingAccounts": "Invalid accounts provided.",
  };

  // Try to extract error code from message
  for (const [code, message] of Object.entries(errorMappings)) {
    if (errorStr.includes(code)) {
      return typeof message === "function" ? message(context) : message;
    }
  }

  // Check for wallet disconnection/session errors (Backpack, Phantom, etc.)
  if (
    errorStr.includes("UserKeyring not found") ||
    errorStr.includes("WalletSignTransactionError") ||
    errorStr.includes("Wallet not connected") ||
    errorStr.includes("WalletNotConnectedError") ||
    errorStr.includes("WalletDisconnectedError") ||
    errorStr.includes("invariant violation")
  ) {
    return "WALLET_DISCONNECTED:Wallet session expired. Please disconnect and reconnect your wallet.";
  }

  // Check for common Solana/wallet errors
  if (errorStr.includes("insufficient funds") || errorStr.includes("Insufficient")) {
    return "Insufficient SOL in your wallet for this transaction.";
  }
  if (errorStr.includes("User rejected")) {
    return "Transaction was cancelled.";
  }
  if (errorStr.includes("Blockhash not found")) {
    return "Network error. Please try again.";
  }

  // Return a cleaned-up version of the original error
  if (errorStr.length > 100) {
    // Extract just the error message part
    const match = errorStr.match(/Error Message: ([^.]+)/);
    if (match) return match[1];
  }

  return errorStr;
}

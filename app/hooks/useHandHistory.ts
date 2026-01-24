"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Program, BN, Idl } from "@coral-xyz/anchor";

// Hand rank names matching the Rust enum order
const HAND_RANKS = [
  "High Card",
  "Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush",
  "Royal Flush",
];

export interface PlayerResult {
  player: string;
  seatIndex: number;
  holeCards: [number, number] | null; // null if folded/not shown
  handRank: string | null;
  chipsWon: number;
  chipsBet: number;
  folded: boolean;
  allIn: boolean;
}

export interface HandHistoryEntry {
  handNumber: number;
  timestamp: Date;
  communityCards: number[];
  totalPot: number;
  players: PlayerResult[];
  signature?: string; // Transaction signature for verification link
}

// Helper to read u64 little-endian from Uint8Array
function readU64LE(data: Uint8Array, offset: number): number {
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  // Read as two 32-bit values to avoid BigInt issues
  const lo = view.getUint32(0, true);
  const hi = view.getUint32(4, true);
  return lo + hi * 0x100000000;
}

// Helper to read i64 little-endian from Uint8Array
function readI64LE(data: Uint8Array, offset: number): number {
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  const lo = view.getUint32(0, true);
  const hi = view.getInt32(4, true); // Signed for high bits
  return lo + hi * 0x100000000;
}

// Parse HandCompleted event from raw buffer (binary deserialization)
// Layout: table_id[32] + hand_number[8] + timestamp[8] + community_cards[5] + total_pot[8] + player_count[1] + results[6*PlayerHandResult] + results_count[1]
// PlayerHandResult: player[32] + seat_index[1] + hole_card_1[1] + hole_card_2[1] + hand_rank[1] + chips_won[8] + chips_bet[8] + folded[1] + all_in[1]
function parseEventFromBuffer(data: Uint8Array, signature: string): HandHistoryEntry | null {
  try {
    let offset = 0;

    console.log("[HandHistory] Buffer length:", data.length);
    console.log("[HandHistory] First 100 bytes:", Array.from(data.slice(0, 100)));

    // table_id: [u8; 32]
    offset += 32;

    // hand_number: u64 (little endian)
    const handNumber = readU64LE(data, offset);
    offset += 8;

    // timestamp: i64 (little endian)
    const timestamp = readI64LE(data, offset);
    offset += 8;

    // community_cards: [u8; 5]
    const communityCards: number[] = [];
    for (let i = 0; i < 5; i++) {
      const card = data[offset + i];
      if (card !== 255) {
        communityCards.push(card);
      }
    }
    offset += 5;

    // total_pot: u64
    const totalPot = readU64LE(data, offset);
    offset += 8;

    // player_count: u8
    const playerCount = data[offset];
    offset += 1;

    console.log("[HandHistory] Parsed header:", { handNumber, timestamp, communityCards, totalPot, playerCount, currentOffset: offset });

    // results: [PlayerHandResult; 6]
    // PlayerHandResult size: 32 + 1 + 1 + 1 + 1 + 8 + 8 + 1 + 1 = 54 bytes
    const PLAYER_RESULT_SIZE = 54;
    const players: PlayerResult[] = [];

    // results_count is at the end, read it first
    const resultsCountOffset = offset + (6 * PLAYER_RESULT_SIZE);
    const resultsCount = data[resultsCountOffset];

    console.log("[HandHistory] resultsCountOffset:", resultsCountOffset, "resultsCount:", resultsCount, "playerCount:", playerCount);

    for (let i = 0; i < resultsCount; i++) {
      const resultOffset = offset + (i * PLAYER_RESULT_SIZE);

      // player: Pubkey (32 bytes)
      const playerBytes = data.slice(resultOffset, resultOffset + 32);
      const player = new PublicKey(playerBytes).toString();

      // seat_index: u8
      const seatIndex = data[resultOffset + 32];

      // hole_card_1: u8
      const holeCard1 = data[resultOffset + 33];

      // hole_card_2: u8
      const holeCard2 = data[resultOffset + 34];

      // hand_rank: u8
      const handRankNum = data[resultOffset + 35];

      // chips_won: u64
      const chipsWon = readU64LE(data, resultOffset + 36);

      // chips_bet: u64
      const chipsBet = readU64LE(data, resultOffset + 44);

      // folded: bool
      const folded = data[resultOffset + 52] !== 0;

      // all_in: bool
      const allIn = data[resultOffset + 53] !== 0;

      players.push({
        player,
        seatIndex,
        holeCards: holeCard1 !== 255 && holeCard2 !== 255 ? [holeCard1, holeCard2] : null,
        handRank: handRankNum !== 255 ? HAND_RANKS[handRankNum] || null : null,
        chipsWon,
        chipsBet,
        folded,
        allIn,
      });
    }

    return {
      handNumber,
      timestamp: new Date(timestamp * 1000),
      communityCards,
      totalPot,
      players,
      signature,
    };
  } catch (e) {
    console.error("[HandHistory] Buffer parse error:", e);
    return null;
  }
}

export function useHandHistory(program: Program<Idl> | null, tableId?: string) {
  const { connection } = useConnection();
  const [history, setHistory] = useState<HandHistoryEntry[]>([]);
  const [isListening, setIsListening] = useState(false);
  const listenerIdRef = useRef<number | null>(null);
  const logListenerIdRef = useRef<number | null>(null);

  // Convert raw event data to our format
  const parseEventData = useCallback((eventData: any, signature?: string): HandHistoryEntry => {
    const players: PlayerResult[] = [];
    const resultsCount = eventData.resultsCount || eventData.results_count || 0;

    for (let i = 0; i < resultsCount; i++) {
      const result = eventData.results[i];
      if (!result) continue;

      const holeCard1 = result.holeCard1 ?? result.hole_card_1;
      const holeCard2 = result.holeCard2 ?? result.hole_card_2;
      const handRankNum = result.handRank ?? result.hand_rank;

      players.push({
        player: result.player?.toString() || "",
        seatIndex: result.seatIndex ?? result.seat_index ?? 0,
        holeCards: holeCard1 !== 255 && holeCard2 !== 255 ? [holeCard1, holeCard2] : null,
        handRank: handRankNum !== 255 ? HAND_RANKS[handRankNum] || null : null,
        chipsWon: Number(result.chipsWon ?? result.chips_won ?? 0),
        chipsBet: Number(result.chipsBet ?? result.chips_bet ?? 0),
        folded: result.folded ?? false,
        allIn: result.allIn ?? result.all_in ?? false,
      });
    }

    // Parse community cards (filter out 255 = not dealt)
    const communityCards = (eventData.communityCards ?? eventData.community_cards ?? [])
      .filter((c: number) => c !== 255);

    return {
      handNumber: Number(eventData.handNumber ?? eventData.hand_number ?? 0),
      timestamp: new Date(Number(eventData.timestamp ?? 0) * 1000),
      communityCards,
      totalPot: Number(eventData.totalPot ?? eventData.total_pot ?? 0),
      players,
      signature,
    };
  }, []);

  // Start listening for events
  const startListening = useCallback(() => {
    if (!program || isListening) return;

    try {
      console.log("[HandHistory] Attempting to start event listener...");
      console.log("[HandHistory] Program ID:", program.programId.toString());

      const listenerId = program.addEventListener("HandCompleted" as any, (event: any, slot: number, signature: string) => {
        console.log("[HandHistory] HandCompleted event received!", { event, slot, signature });

        const entry = parseEventData(event, signature);
        console.log("[HandHistory] Parsed entry:", entry);

        // Add to history (newest first)
        setHistory(prev => {
          // Avoid duplicates by checking hand number
          if (prev.some(h => h.handNumber === entry.handNumber)) {
            console.log("[HandHistory] Duplicate hand, skipping");
            return prev;
          }
          console.log("[HandHistory] Adding hand to history");
          return [entry, ...prev].slice(0, 50); // Keep last 50 hands
        });
      });

      listenerIdRef.current = listenerId;
      setIsListening(true);
      console.log("[HandHistory] Successfully started listening for HandCompleted events, listener ID:", listenerId);

      // Also subscribe to program logs as primary method (Anchor addEventListener doesn't work with new IDL format)
      try {
        const logListenerId = connection.onLogs(
          program.programId,
          async (logs, ctx) => {
            // Check if this is a showdown transaction with our event
            const hasHandCompleted = logs.logs.some(log =>
              log.includes("HandCompleted event emitted") ||
              (log.includes("Hand #") && log.includes("complete"))
            );
            if (hasHandCompleted) {
              console.log("[HandHistory] Detected HandCompleted in logs!", {
                signature: logs.signature,
                logs: logs.logs,
              });

              // Parse the event data from logs
              // The event is encoded as base64 in a "Program data:" log line
              try {
                const dataLog = logs.logs.find(log => log.startsWith("Program data:"));
                if (dataLog) {
                  const base64Data = dataLog.replace("Program data: ", "");
                  // Decode base64 to Uint8Array (browser-compatible)
                  const binaryString = atob(base64Data);
                  const bytes = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }

                  // Skip the 8-byte discriminator
                  const data = bytes.slice(8);

                  // Parse the event manually based on our struct layout
                  const entry = parseEventFromBuffer(data, logs.signature);

                  if (entry) {
                    console.log("[HandHistory] Parsed event from logs:", entry);
                    setHistory(prev => {
                      if (prev.some(h => h.handNumber === entry.handNumber)) {
                        return prev;
                      }
                      return [entry, ...prev].slice(0, 50);
                    });
                  }
                }
              } catch (parseError) {
                console.error("[HandHistory] Failed to parse event from logs:", parseError);
              }
            }
          },
          "confirmed"
        );
        logListenerIdRef.current = logListenerId;
        console.log("[HandHistory] Also subscribed to program logs, listener ID:", logListenerId);
      } catch (logError) {
        console.warn("[HandHistory] Could not subscribe to logs (non-fatal):", logError);
      }
    } catch (error) {
      console.error("[HandHistory] Failed to start event listener:", error);
    }
  }, [program, isListening, parseEventData, connection]);

  // Stop listening
  const stopListening = useCallback(() => {
    if (listenerIdRef.current !== null && program) {
      try {
        program.removeEventListener(listenerIdRef.current);
        console.log("[HandHistory] Removed Anchor event listener");
      } catch (error) {
        console.error("[HandHistory] Failed to remove event listener:", error);
      }
      listenerIdRef.current = null;
    }

    if (logListenerIdRef.current !== null) {
      try {
        connection.removeOnLogsListener(logListenerIdRef.current);
        console.log("[HandHistory] Removed log listener");
      } catch (error) {
        console.error("[HandHistory] Failed to remove log listener:", error);
      }
      logListenerIdRef.current = null;
    }

    setIsListening(false);
  }, [program, connection]);

  // Clear history
  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  // Auto-start listening when program is available
  useEffect(() => {
    if (program && !isListening) {
      startListening();
    }

    return () => {
      if (isListening) {
        stopListening();
      }
    };
  }, [program, isListening, startListening, stopListening]);

  return {
    history,
    isListening,
    startListening,
    stopListening,
    clearHistory,
  };
}

// Helper to format cards for display
export function formatCard(cardNum: number): string {
  if (cardNum === 255 || cardNum < 0 || cardNum > 51) return "?";

  const suits = ["♥", "♦", "♣", "♠"];
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

  const suit = Math.floor(cardNum / 13);
  const rank = cardNum % 13;

  return `${ranks[rank]}${suits[suit]}`;
}

// Helper to get suit color (for dark backgrounds)
export function getSuitColor(cardNum: number): string {
  if (cardNum === 255 || cardNum < 0 || cardNum > 51) return "text-gray-500";
  const suit = Math.floor(cardNum / 13);
  return suit <= 1 ? "text-red-500" : "text-gray-200"; // Hearts/Diamonds = red, Clubs/Spades = light gray (visible on dark bg)
}

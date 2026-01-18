"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { usePokerProgram } from "./usePokerProgram";
import {
  PROGRAM_ID,
  getTablePDA,
  getSeatPDA,
  getHandPDA,
  getDeckPDA,
  getVaultPDA,
  generateTableId,
} from "@/lib/program";
import {
  DEFAULT_QUEUE,
  waitForShuffle,
  isAccountDelegated,
  isAccountDelegatedByOwner,
} from "@/lib/magicblock";

// Inco Lightning FHE Program ID
const INCO_PROGRAM_ID = new PublicKey("5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj");

// Derive Inco allowance PDA from encrypted handle
// Seeds: [handle_le_bytes, player_pubkey] (NO "allowance" prefix!)
function getIncoAllowancePDA(handle: bigint, playerPubkey: PublicKey): [PublicKey, number] {
  // Convert BigInt handle to 16-byte little-endian buffer
  const handleBuf = Buffer.alloc(16);
  let h = handle;
  for (let i = 0; i < 16; i++) {
    handleBuf[i] = Number(h & BigInt(0xFF));
    h >>= BigInt(8);
  }
  return PublicKey.findProgramAddressSync(
    [handleBuf, playerPubkey.toBuffer()],
    INCO_PROGRAM_ID
  );
}
import {
  mapPlayerStatus,
  mapGamePhase,
  mapTableStatus,
  getOccupiedSeats,
  parseAnchorError,
} from "@/lib/utils";
import { decryptCards } from "@/lib/inco";

// Types matching the IDL
export interface TableAccount {
  authority: PublicKey;
  tableId: number[];
  smallBlind: BN;
  bigBlind: BN;
  minBuyIn: BN;
  maxBuyIn: BN;
  maxPlayers: number;
  currentPlayers: number;
  status: { waiting?: object; playing?: object; closed?: object };
  handNumber: BN;
  occupiedSeats: number;
  dealerPosition: number;
  lastReadyTime: BN; // Unix timestamp for start_hand timeout
  bump: number;
}

export interface HandStateAccount {
  table: PublicKey;
  handNumber: BN;
  phase: { dealing?: object; preFlop?: object; flop?: object; turn?: object; river?: object; showdown?: object; settled?: object };
  pot: BN;
  currentBet: BN;
  minRaise: BN;
  dealerPosition: number;
  actionOn: number;
  communityCards: number[];
  communityRevealed: number;
  activePlayers: number;
  actedThisRound: number;
  activeCount: number;
  lastActionTime: BN;  // Unix timestamp (seconds)
  handStartTime: BN;   // Unix timestamp (seconds)
  bump: number;
}

export interface PlayerSeatAccount {
  table: PublicKey;
  player: PublicKey;
  seatIndex: number;
  chips: BN;
  currentBet: BN;
  totalBetThisHand: BN;
  holeCard1: BN;
  holeCard2: BN;
  revealedCard1: number;  // Revealed plaintext card (0-51 or 255)
  revealedCard2: number;  // Revealed plaintext card (0-51 or 255)
  cardsRevealed: boolean; // Whether player has revealed cards for showdown
  status: { sitting?: object; playing?: object; folded?: object; allIn?: object };
  hasActed: boolean;
  bump: number;
}

export interface DeckStateAccount {
  hand: PublicKey;
  cards: BN[];
  dealIndex: number;
  isShuffled: boolean;
  bump: number;
  // Note: vrfSeed and seedReceived removed in Modified Option B
  // VRF seed is never stored - only used in memory during callback
}

// UI-friendly types
export interface Player {
  seatIndex: number;
  player: string;
  chips: number;
  currentBet: number;
  holeCards: [number | null, number | null];
  status: "empty" | "sitting" | "playing" | "folded" | "allin";
  isActive: boolean;
  isDelegated?: boolean; // Whether seat is delegated to ER
  isEncrypted?: boolean; // Whether hole cards are Inco-encrypted
  cardsRevealed?: boolean; // Whether cards have been revealed for showdown
  revealedCards?: [number | null, number | null]; // Plaintext cards after reveal (0-51)
}

export interface GameState {
  tableId: string;
  tablePDA: PublicKey | null;
  table: TableAccount | null;
  handState: HandStateAccount | null;
  deckState: DeckStateAccount | null;
  players: Player[];
  phase: "Dealing" | "PreFlop" | "Flop" | "Turn" | "River" | "Showdown" | "Settled";
  tableStatus: "Waiting" | "Playing" | "Closed";
  pot: number;
  currentBet: number;
  minRaise: number;
  communityCards: number[];
  dealerPosition: number;
  actionOn: number;
  smallBlind: number;
  bigBlind: number;
  isAuthority: boolean;
  currentPlayerSeat: number | null;
  lastActionTime: number | null; // Unix timestamp for timeout tracking
  lastReadyTime: number | null; // Unix timestamp for start_hand timeout
  // MagicBlock state
  useVrf: boolean; // Whether to use VRF for shuffling
  isShuffling: boolean; // VRF shuffle in progress
  isDeckShuffled: boolean; // VRF shuffle complete
  // Delegation state
  isSeatDelegated: boolean; // Whether current player's seat is delegated to ER
  isGameDelegated: boolean; // Whether hand/deck/seats are all delegated to ER
  isDelegating: boolean; // Delegation in progress
  isUndelegating: boolean; // Undelegation in progress
  usePrivacyMode: boolean; // Whether to auto-delegate for privacy (ER-based)
  // Inco FHE privacy state
  useIncoPrivacy: boolean; // Whether to use Inco FHE encryption for cards
  isEncrypting: boolean; // Inco encryption in progress
  areCardsEncrypted: boolean; // Whether current cards are Inco-encrypted
  areAllowancesGranted: boolean; // Whether decryption allowances have been granted
  isDecrypting: boolean; // Inco decryption in progress
  decryptedCards: [number | null, number | null]; // Client-side decrypted cards
  isRevealing: boolean; // Card reveal in progress (for showdown)
  encryptionHandNumber: number | null; // Hand number when encryption was detected (prevents cross-hand leakage)
}

export interface UsePokerGameResult {
  // State
  gameState: GameState;
  loading: boolean;
  error: string | null;

  // Actions
  createTable: (config: CreateTableConfig) => Promise<string>;
  joinTable: (seatIndex: number, buyInSol: number) => Promise<string>;
  leaveTable: () => Promise<string>;
  startHand: () => Promise<string>;
  dealCards: () => Promise<string>;
  playerAction: (action: ActionType) => Promise<string>;
  showdown: () => Promise<string>;
  timeoutPlayer: () => Promise<string>;

  // MagicBlock VRF Actions
  requestShuffle: () => Promise<string>;
  dealCardsVrf: () => Promise<string>;

  // MagicBlock Delegation Actions
  delegateSeat: () => Promise<string>;
  delegateHand: () => Promise<string>;
  delegateDeck: () => Promise<string>;
  delegateGameState: () => Promise<void>; // Delegates all game accounts
  undelegateSeat: () => Promise<string>;
  undelegateHand: () => Promise<string>;
  undelegateDeck: () => Promise<string>;
  undelegateGameState: () => Promise<void>; // Undelegates all game accounts

  // Inco FHE Encryption Actions
  encryptHoleCards: (seatIndex: number) => Promise<string>; // Phase 1: Encrypt cards
  grantCardAllowance: (seatIndex: number) => Promise<string>; // Phase 2: Grant decryption
  revealCards: () => Promise<string>; // Reveal decrypted cards for showdown
  encryptAndGrantCards: (seatIndex: number) => Promise<void>; // Combined helper
  encryptAllPlayersCards: () => Promise<void>; // Encrypt all players' cards
  grantAllPlayersAllowances: () => Promise<void>; // Grant allowances only (for atomic encryption)
  decryptMyCards: () => Promise<void>; // Client-side decrypt own cards

  // Game Liveness Actions (prevent stuck games)
  grantOwnAllowance: () => Promise<string>; // Self-grant allowance after 60s timeout
  timeoutReveal: (targetSeat: number) => Promise<string>; // Muck non-revealing player after 3 min
  closeInactiveTable: () => Promise<string>; // Close inactive table after 1 hour, return funds

  // Utilities
  refreshState: () => Promise<void>;
  setTableId: (tableId: string) => void;
  setUseVrf: (useVrf: boolean) => void;
  setUsePrivacyMode: (usePrivacy: boolean) => void;
  setUseIncoPrivacy: (useInco: boolean) => void;
  checkDelegationStatus: () => Promise<boolean>;
}

export interface CreateTableConfig {
  tableId: string;
  smallBlind: number; // in lamports
  bigBlind: number; // in lamports
  minBuyIn: number; // in lamports
  maxBuyIn: number; // in lamports
  maxPlayers: number;
}

export type ActionType =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "raise"; amount: number }
  | { type: "allIn" };

const initialGameState: GameState = {
  tableId: "",
  tablePDA: null,
  table: null,
  handState: null,
  deckState: null,
  players: [],
  phase: "Settled",
  tableStatus: "Waiting",
  pot: 0,
  currentBet: 0,
  minRaise: 0,
  communityCards: [],
  dealerPosition: 0,
  actionOn: 0,
  smallBlind: 0,
  bigBlind: 0,
  isAuthority: false,
  currentPlayerSeat: null,
  lastActionTime: null,
  lastReadyTime: null,
  // MagicBlock state
  useVrf: true, // VRF oracle is working - use provably fair shuffling
  isShuffling: false,
  isDeckShuffled: false,
  // Delegation state
  isSeatDelegated: false,
  isGameDelegated: false,
  isDelegating: false,
  isUndelegating: false,
  usePrivacyMode: false, // Default to public mode (toggle on for privacy via ER)
  // Inco FHE privacy state
  useIncoPrivacy: true, // Default to Inco privacy ON (cryptographic card encryption)
  isEncrypting: false,
  areCardsEncrypted: false,
  areAllowancesGranted: false,
  isDecrypting: false,
  decryptedCards: [null, null],
  isRevealing: false,
  encryptionHandNumber: null, // Track which hand encryption belongs to
};

export function usePokerGame(): UsePokerGameResult {
  const { program, provider, publicKey, erProgram, erProvider, erConnection, signMessage } = usePokerProgram();
  const [gameState, setGameState] = useState<GameState>(initialGameState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  // Ref to track encryptionHandNumber for stale closure prevention in refreshState
  const encryptionHandNumberRef = useRef<number | null>(null);

  // Keep the ref in sync with gameState.encryptionHandNumber
  useEffect(() => {
    encryptionHandNumberRef.current = gameState.encryptionHandNumber;
  }, [gameState.encryptionHandNumber]);

  // Toggle VRF mode
  const setUseVrf = useCallback((useVrf: boolean) => {
    setGameState((prev) => ({ ...prev, useVrf }));
  }, []);

  // Toggle Privacy mode (auto-delegation via MagicBlock ER)
  const setUsePrivacyMode = useCallback((usePrivacyMode: boolean) => {
    setGameState((prev) => ({ ...prev, usePrivacyMode }));
  }, []);

  // Toggle Inco FHE Privacy mode (cryptographic card encryption)
  const setUseIncoPrivacy = useCallback((useIncoPrivacy: boolean) => {
    setGameState((prev) => ({ ...prev, useIncoPrivacy }));
  }, []);

  // Check if current player's seat is delegated to ER
  const checkDelegationStatus = useCallback(async (): Promise<boolean> => {
    if (!provider || !gameState.tablePDA || gameState.currentPlayerSeat === null) {
      return false;
    }

    try {
      const [seatPDA] = getSeatPDA(gameState.tablePDA, gameState.currentPlayerSeat);
      const isDelegated = await isAccountDelegated(provider.connection, seatPDA);
      setGameState((prev) => ({ ...prev, isSeatDelegated: isDelegated }));
      return isDelegated;
    } catch (e) {
      console.error("Error checking delegation status:", e);
      return false;
    }
  }, [provider, gameState.tablePDA, gameState.currentPlayerSeat]);

  // Set table ID and derive PDA
  const setTableId = useCallback((tableId: string) => {
    if (!tableId) {
      setGameState(initialGameState);
      return;
    }
    const tableIdBytes = generateTableId(tableId);
    const [tablePDA] = getTablePDA(tableIdBytes);
    setGameState((prev) => ({
      ...prev,
      tableId,
      tablePDA,
    }));
  }, []);

  // Fetch all player seats for a table
  // useER: if true, fetch from ER (for delegated accounts)
  const fetchPlayerSeats = useCallback(
    async (tablePDA: PublicKey, maxPlayers: number, occupiedSeats: number, useER: boolean = false): Promise<Player[]> => {
      const activeProgram = useER && erProgram ? erProgram : program;
      if (!activeProgram) return [];

      const players: Player[] = [];
      const occupied = getOccupiedSeats(occupiedSeats, maxPlayers);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accounts = activeProgram.account as any;

      for (let i = 0; i < maxPlayers; i++) {
        if (occupied.includes(i)) {
          try {
            const [seatPDA] = getSeatPDA(tablePDA, i);
            const seat = await accounts.playerSeat.fetch(seatPDA) as PlayerSeatAccount;

            // Convert hole cards - handle both plaintext (0-51) and encrypted (u128 handles)
            const isCurrentPlayer = publicKey?.equals(seat.player);

            // Use BigInt for safe handling of large u128 encrypted values
            const holeCard1BigInt = BigInt(seat.holeCard1.toString());
            const holeCard2BigInt = BigInt(seat.holeCard2.toString());

            // Check if cards are encrypted (values > 51) or plaintext (0-51)
            // 255 means not dealt yet - exclude from "encrypted" check
            // Encrypted handles are large u128 values, definitely > 255
            const isCard1Encrypted = holeCard1BigInt > BigInt(255);
            const isCard2Encrypted = holeCard2BigInt > BigInt(255);
            const areCardsEncrypted = isCard1Encrypted || isCard2Encrypted;

            // For plaintext cards, safely convert to number
            const holeCard1 = isCard1Encrypted ? null : Number(holeCard1BigInt);
            const holeCard2 = isCard2Encrypted ? null : Number(holeCard2BigInt);

            // Check if cards have been dealt - card value 255 means not dealt
            // Cards are valid if they're either plaintext (0-51) OR encrypted (> 51)
            const hasDealtCards = holeCard1BigInt !== BigInt(255) && holeCard2BigInt !== BigInt(255);
            const hasValidPlaintextCards = hasDealtCards && !areCardsEncrypted &&
                                           holeCard1 !== null && holeCard1 >= 0 && holeCard1 <= 51 &&
                                           holeCard2 !== null && holeCard2 >= 0 && holeCard2 <= 51;

            // Get revealed cards (set during showdown via reveal_cards instruction)
            const revealedCard1 = seat.revealedCard1;
            const revealedCard2 = seat.revealedCard2;
            const hasRevealedCards = seat.cardsRevealed &&
                                     revealedCard1 !== 255 && revealedCard2 !== 255 &&
                                     revealedCard1 >= 0 && revealedCard1 <= 51 &&
                                     revealedCard2 >= 0 && revealedCard2 <= 51;

            players.push({
              seatIndex: seat.seatIndex,
              player: seat.player.toString(),
              chips: seat.chips.toNumber(),
              currentBet: seat.totalBetThisHand.toNumber(), // Use total bet this hand, not per-round
              // Show cards if: current player AND cards are plaintext valid (0-51)
              // Encrypted cards will show as null (hidden) - need Inco decryption
              holeCards: isCurrentPlayer && hasValidPlaintextCards
                ? [holeCard1!, holeCard2!]
                : [null, null],
              status: mapPlayerStatus(seat.status),
              // Player is active if cards have been dealt (encrypted or plaintext)
              isActive: hasDealtCards,
              // Track if cards are encrypted for UI display
              isEncrypted: areCardsEncrypted,
              // Track if cards have been revealed for showdown
              cardsRevealed: seat.cardsRevealed ?? false,
              // Revealed cards for showdown display (visible to all players)
              revealedCards: hasRevealedCards ? [revealedCard1, revealedCard2] : [null, null],
            });
          } catch (e) {
            // Seat PDA doesn't exist yet
            players.push({
              seatIndex: i,
              player: "",
              chips: 0,
              currentBet: 0,
              holeCards: [null, null],
              status: "empty",
              isActive: false,
              isEncrypted: false,
              cardsRevealed: false,
              revealedCards: [null, null],
            });
          }
        } else {
          players.push({
            seatIndex: i,
            player: "",
            chips: 0,
            currentBet: 0,
            holeCards: [null, null],
            status: "empty",
            isActive: false,
            isEncrypted: false,
            cardsRevealed: false,
            revealedCards: [null, null],
          });
        }
      }

      return players;
    },
    [program, erProgram, publicKey]
  );

  // Refresh all game state
  // Fetches from ER when game is delegated, otherwise from base layer
  // Auto-detects delegation by checking account owners
  const refreshState = useCallback(async () => {
    if (!program || !provider || !gameState.tablePDA) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseAccounts = program.account as any; // Table is always on base layer

    // First, fetch table from base layer to get hand number
    let table: TableAccount;
    try {
      table = await baseAccounts.table.fetch(gameState.tablePDA) as TableAccount;
    } catch (e) {
      setGameState((prev) => ({
        ...prev,
        table: null,
        tableStatus: "Waiting",
      }));
      return;
    }

    // Auto-detect if game is delegated by checking if hand state is owned by Delegation Program
    // Only check when table is actively Playing - we don't care about old delegated accounts from previous hands
    const tableStatus = mapTableStatus(table.status);
    let detectedDelegation = false;
    if (tableStatus === "Playing" && table.handNumber.toNumber() > 0) {
      const [handPDA] = getHandPDA(gameState.tablePDA, BigInt(table.handNumber.toNumber()));
      detectedDelegation = await isAccountDelegatedByOwner(provider.connection, handPDA);
      if (detectedDelegation) {
        console.log("Auto-detected: Game is delegated to ER");
      }
    }
    // Reset delegation state when table goes back to Waiting (hand is over)
    if (tableStatus === "Waiting") {
      detectedDelegation = false;
    }

    // Use ER if we detected delegation OR if local state says delegated
    const useER = (detectedDelegation || gameState.isGameDelegated) && !!erProgram;
    const activeProgram = useER ? erProgram : program;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = activeProgram.account as any;

    try {
      // Table was already fetched above for delegation detection
      // tableStatus already computed above
      const isAuthority = publicKey?.equals(table.authority) ?? false;

      // Fetch player seats - from ER when delegated
      const players = await fetchPlayerSeats(
        gameState.tablePDA,
        table.maxPlayers,
        table.occupiedSeats,
        useER // Pass useER flag to fetch from ER when delegated
      );

      // Find current player's seat
      const currentPlayerSeat = players.find(
        (p) => p.player === publicKey?.toString()
      )?.seatIndex ?? null;

      // Fetch hand state if playing
      let handState: HandStateAccount | null = null;
      let deckState: DeckStateAccount | null = null;
      if (tableStatus === "Playing" && table.handNumber.toNumber() > 0) {
        try {
          const [handPDA] = getHandPDA(gameState.tablePDA, BigInt(table.handNumber.toNumber()));
          handState = await accounts.handState.fetch(handPDA) as HandStateAccount;

          // Also fetch deck state for VRF status
          const [deckPDA] = getDeckPDA(gameState.tablePDA, BigInt(table.handNumber.toNumber()));
          try {
            deckState = await accounts.deckState.fetch(deckPDA) as DeckStateAccount;
          } catch (e) {
            // Deck state might not exist yet
          }
        } catch (e) {
          // Hand doesn't exist yet
        }
      }

      const phase = handState ? mapGamePhase(handState.phase) : "Settled";
      // Convert community cards to plain numbers
      // They come from on-chain as Vec<u8>, which Anchor might deserialize as Buffer/Uint8Array or number[]
      let communityCards: number[] = [];
      if (handState?.communityCards) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = handState.communityCards as any;
        if (Array.isArray(raw)) {
          communityCards = raw.map((c: unknown) => typeof c === 'number' ? c : Number(c));
        } else if (raw instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw))) {
          communityCards = Array.from(raw);
        } else if (raw && typeof raw[Symbol.iterator] === 'function') {
          // Fallback: try to iterate
          communityCards = Array.from(raw);
        }
      }

      // Get current hand number for tracking encryption state across hands
      const currentHandNumber = table.handNumber.toNumber();

      // Reset Inco encryption state when:
      // 1. Phase is Dealing (hand just started)
      // 2. Table is Waiting (between hands)
      // 3. Hand number changed from what we last tracked (prevents cross-hand state leakage)
      // NOTE: Uses ref to avoid stale closure - refreshState dependencies don't include encryptionHandNumber
      const isNewHand = encryptionHandNumberRef.current !== null &&
                        currentHandNumber !== encryptionHandNumberRef.current;
      const resetEncryptionState = phase === "Dealing" || tableStatus === "Waiting" || isNewHand;

      // Detect if cards are encrypted from on-chain state (any player has encrypted cards)
      // This syncs encryption state for all players, not just the authority who dealt
      // IMPORTANT: Only consider cards encrypted if we're past the Dealing phase
      // During Dealing phase, old encrypted cards from previous hand might still be present
      const detectedCardsEncrypted = phase !== "Dealing" && players.some(p => p.isEncrypted === true);

      // Check if current player's allowances have been granted on-chain
      // This allows all players to detect when they can decrypt, not just the authority
      let detectedAllowancesGranted = false;
      if (currentPlayerSeat !== null && !resetEncryptionState && detectedCardsEncrypted) {
        const currentPlayer = players.find(p => p.seatIndex === currentPlayerSeat);
        if (currentPlayer?.isEncrypted && publicKey) {
          // Get the current player's encrypted handles from on-chain
          try {
            const [seatPDA] = getSeatPDA(gameState.tablePDA, currentPlayerSeat);
            const seat = await accounts.playerSeat.fetch(seatPDA) as PlayerSeatAccount;
            const handle1 = BigInt(seat.holeCard1.toString());
            const handle2 = BigInt(seat.holeCard2.toString());

            // Check if allowance accounts exist AND are owned by Inco program
            if (handle1 > BigInt(255) && handle2 > BigInt(255)) {
              const [allowancePDA1] = getIncoAllowancePDA(handle1, publicKey);
              const [allowancePDA2] = getIncoAllowancePDA(handle2, publicKey);

              // Check if both allowance accounts exist and are owned by Inco
              const [acct1, acct2] = await Promise.all([
                provider.connection.getAccountInfo(allowancePDA1),
                provider.connection.getAccountInfo(allowancePDA2),
              ]);

              // Verify accounts exist AND are owned by Inco program (not just any account)
              const isValid1 = acct1 !== null && acct1.owner.equals(INCO_PROGRAM_ID);
              const isValid2 = acct2 !== null && acct2.owner.equals(INCO_PROGRAM_ID);
              detectedAllowancesGranted = isValid1 && isValid2;

            }
          } catch (e) {
            // Ignore errors - allowances not yet granted
          }
        }
      }

      setGameState((prev) => ({
        ...prev,
        table,
        handState,
        deckState,
        players,
        phase,
        tableStatus,
        pot: handState?.pot.toNumber() ?? 0,
        currentBet: handState?.currentBet.toNumber() ?? 0,
        minRaise: handState?.minRaise.toNumber() ?? table.bigBlind.toNumber(),
        communityCards,
        dealerPosition: handState?.dealerPosition ?? table.dealerPosition,
        actionOn: handState?.actionOn ?? 0,
        smallBlind: table.smallBlind.toNumber(),
        bigBlind: table.bigBlind.toNumber(),
        isAuthority,
        currentPlayerSeat,
        lastActionTime: handState?.lastActionTime?.toNumber() ?? null,
        lastReadyTime: table.lastReadyTime?.toNumber() ?? null,
        // isShuffled means VRF callback completed atomic shuffle + encrypt
        isDeckShuffled: deckState?.isShuffled ?? false,
        // Auto-update delegation status based on detection
        // Reset to false when table is Waiting (hand is over), otherwise preserve/detect
        isGameDelegated: tableStatus === "Waiting" ? false : (detectedDelegation || gameState.isGameDelegated),
        isSeatDelegated: tableStatus === "Waiting" ? false : (detectedDelegation || gameState.isSeatDelegated),
        // Reset Inco encryption state for new hands or when hand number changes
        areCardsEncrypted: resetEncryptionState ? false : (detectedCardsEncrypted || prev.areCardsEncrypted),
        // Allowances: prefer on-chain detection, but preserve local state to avoid race conditions
        // Only preserve local state if we're in the same hand (detectedCardsEncrypted implies same hand)
        areAllowancesGranted: resetEncryptionState ? false : (detectedAllowancesGranted || (detectedCardsEncrypted && prev.areAllowancesGranted)),
        isEncrypting: resetEncryptionState ? false : prev.isEncrypting,
        isDecrypting: resetEncryptionState ? false : prev.isDecrypting,
        decryptedCards: resetEncryptionState ? [null, null] : prev.decryptedCards,
        // Track which hand the encryption state belongs to (for cross-hand leak prevention)
        encryptionHandNumber: resetEncryptionState ? null : (detectedCardsEncrypted ? currentHandNumber : prev.encryptionHandNumber),
      }));

      setError(null);
    } catch (e) {
      console.error("Error refreshing state:", e);
      setError(e instanceof Error ? e.message : "Failed to fetch game state");
    }
  }, [program, provider, erProgram, gameState.tablePDA, gameState.isGameDelegated, gameState.isSeatDelegated, publicKey, fetchPlayerSeats]);

  // Start polling when table is set
  useEffect(() => {
    if (gameState.tablePDA && program) {
      // Initial fetch
      refreshState();

      // Poll every 3 seconds
      pollingRef.current = setInterval(refreshState, 3000);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [gameState.tablePDA, program, refreshState]);

  // Create a new table
  const createTable = useCallback(
    async (config: CreateTableConfig): Promise<string> => {
      if (!program || !provider || !publicKey) {
        throw new Error("Wallet not connected");
      }

      setLoading(true);
      setError(null);

      try {
        const tableIdBytes = generateTableId(config.tableId);
        const [tablePDA] = getTablePDA(tableIdBytes);
        const [vaultPDA] = getVaultPDA(tablePDA);

        // Check if table already exists using getAccountInfo (cleaner than fetch)
        const existingAccount = await provider.connection.getAccountInfo(tablePDA);
        if (existingAccount !== null) {
          // Table exists - load it and inform user
          setTableId(config.tableId);
          await refreshState();
          throw new Error(`Table "${config.tableId}" already exists. Loading existing table instead.`);
        }

        const tx = await program.methods
          .createTable(
            Array.from(tableIdBytes),
            new BN(config.smallBlind),
            new BN(config.bigBlind),
            new BN(config.minBuyIn),
            new BN(config.maxBuyIn),
            config.maxPlayers
          )
          .accounts({
            authority: publicKey,
            table: tablePDA,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        // Update local state
        setTableId(config.tableId);
        await refreshState();

        return tx;
      } catch (e) {
        const message = parseAnchorError(e);
        setError(message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [program, provider, publicKey, setTableId, refreshState]
  );

  // Join table (with optional auto-delegation for privacy)
  const joinTable = useCallback(
    async (seatIndex: number, buyInLamports: number): Promise<string> => {
      if (!program || !provider || !publicKey || !gameState.tablePDA) {
        throw new Error("Wallet not connected or table not set");
      }

      setLoading(true);
      setError(null);

      try {
        const [seatPDA] = getSeatPDA(gameState.tablePDA, seatIndex);
        const [vaultPDA] = getVaultPDA(gameState.tablePDA);

        // Step 1: Join the table on base layer
        const tx = await program.methods
          .joinTable(seatIndex, new BN(buyInLamports))
          .accounts({
            player: publicKey,
            table: gameState.tablePDA,
            playerSeat: seatPDA,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        await provider.connection.confirmTransaction(tx, "confirmed");
        await refreshState();

        // Privacy mode note: Seats are NOT delegated on join.
        // Full privacy requires delegating ALL game accounts together AFTER startHand:
        // 1. startHand() - creates handState + deckState on base layer
        // 2. requestShuffle() - VRF shuffle on base layer (if using VRF)
        // 3. [wait for shuffle to complete]
        // 4. delegateGameState() - delegates hand + deck + all seats together
        // 5. dealCardsVrf() / dealCards() - now runs on ER
        // 6. playerAction() - runs on ER (fast + private)
        // 7. showdown() - runs on ER
        // 8. undelegateGameState() - commits state back to base layer
        if (gameState.usePrivacyMode) {
          console.log("Privacy mode enabled. After startHand, call delegateGameState() to enable privacy.");
          console.log("Flow: startHand → [shuffle if VRF] → delegateGameState → deal → play → showdown → undelegateGameState");
        }

        return tx;
      } catch (e) {
        const message = parseAnchorError(e, {
          minBuyIn: gameState.table?.minBuyIn.toNumber(),
          maxBuyIn: gameState.table?.maxBuyIn.toNumber(),
        });
        setError(message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [program, provider, publicKey, gameState.tablePDA, gameState.table, gameState.usePrivacyMode, refreshState]
  );

  // Leave table (with auto-undelegation if delegated)
  const leaveTable = useCallback(async (): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || gameState.currentPlayerSeat === null) {
      throw new Error("Not at table");
    }

    setLoading(true);
    setError(null);

    try {
      const [seatPDA] = getSeatPDA(gameState.tablePDA, gameState.currentPlayerSeat);
      const [vaultPDA] = getVaultPDA(gameState.tablePDA);

      // Step 1: If game state is delegated, check if seat is actually delegated and undelegate first
      if (gameState.isGameDelegated && erProgram && erProvider) {
        // First check if seat is actually delegated (might have been undelegated by showdown)
        const isSeatActuallyDelegated = await isAccountDelegatedByOwner(provider.connection, seatPDA);

        if (isSeatActuallyDelegated) {
          console.log("Seat is delegated - undelegating from Ephemeral Rollup...");
          setGameState((prev) => ({ ...prev, isUndelegating: true }));

          try {
            const undelegateTx = await erProgram.methods
              .undelegateSeat()
              .accounts({
                payer: publicKey,
                table: gameState.tablePDA,
                seat: seatPDA,
              })
              .rpc();

            await erProvider.connection.confirmTransaction(undelegateTx, "confirmed");
            console.log("Seat undelegated successfully:", undelegateTx);

            // Wait a bit for state to commit to base layer
            await new Promise(resolve => setTimeout(resolve, 2000));

            setGameState((prev) => ({
              ...prev,
              isUndelegating: false,
              isSeatDelegated: false,
            }));
          } catch (undelegateError) {
            console.warn("Failed to undelegate seat (may already be undelegated):", undelegateError);
            setGameState((prev) => ({ ...prev, isUndelegating: false }));
            // Continue to leave - seat might already be on base layer
          }
        } else {
          console.log("Seat already on base layer (was undelegated by showdown)");
          setGameState((prev) => ({ ...prev, isGameDelegated: false, isSeatDelegated: false }));
        }
      }

      // Step 2: Leave the table on base layer
      const tx = await program.methods
        .leaveTable()
        .accounts({
          player: publicKey,
          table: gameState.tablePDA,
          playerSeat: seatPDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await provider.connection.confirmTransaction(tx, "confirmed");
      setGameState((prev) => ({ ...prev, isSeatDelegated: false, isGameDelegated: false }));
      await refreshState();
      return tx;
    } catch (e) {
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, provider, erProgram, erProvider, publicKey, gameState.tablePDA, gameState.currentPlayerSeat, gameState.isGameDelegated, refreshState]);

  // Start hand (authority only)
  const startHand = useCallback(async (): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table) {
      throw new Error("Table not ready");
    }

    setLoading(true);
    setError(null);

    // IMPORTANT: Reset ALL encryption state when starting a new hand
    // This prevents stale state from previous hands from leaking through
    setGameState((prev) => ({
      ...prev,
      areCardsEncrypted: false,
      areAllowancesGranted: false,
      isEncrypting: false,
      isDecrypting: false,
      decryptedCards: [null, null],
      encryptionHandNumber: null,
    }));

    try {
      const handNumber = BigInt(gameState.table.handNumber.toNumber() + 1);
      const [handPDA] = getHandPDA(gameState.tablePDA, handNumber);
      const [deckPDA] = getDeckPDA(gameState.tablePDA, handNumber);

      const tx = await program.methods
        .startHand()
        .accounts({
          caller: publicKey,
          table: gameState.tablePDA,
          handState: handPDA,
          deckState: deckPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await provider.connection.confirmTransaction(tx, "confirmed");
      await refreshState();
      return tx;
    } catch (e) {
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, provider, publicKey, gameState.tablePDA, gameState.table, refreshState]);

  // Deal cards (pseudorandom - non-VRF fallback)
  const dealCards = useCallback(async (): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table) {
      throw new Error("Table not ready");
    }

    setLoading(true);
    setError(null);

    try {
      const handNumber = BigInt(gameState.table.handNumber.toNumber());
      const [handPDA] = getHandPDA(gameState.tablePDA, handNumber);
      const [deckPDA] = getDeckPDA(gameState.tablePDA, handNumber);

      // Find SB and BB positions
      const dealerPos = gameState.table.dealerPosition;
      const occupied = getOccupiedSeats(gameState.table.occupiedSeats, gameState.table.maxPlayers);
      const isHeadsUp = occupied.length === 2;

      // Find next occupied seats after dealer for SB and BB
      const findNextOccupied = (startPos: number): number => {
        let pos = (startPos + 1) % gameState.table!.maxPlayers;
        while (!occupied.includes(pos)) {
          pos = (pos + 1) % gameState.table!.maxPlayers;
        }
        return pos;
      };

      let sbPos: number;
      let bbPos: number;

      if (isHeadsUp) {
        // Heads-up: dealer is SB, other player is BB
        sbPos = dealerPos;
        bbPos = findNextOccupied(dealerPos);
      } else {
        // Standard: SB is left of dealer, BB is left of SB
        sbPos = findNextOccupied(dealerPos);
        bbPos = findNextOccupied(sbPos);
      }

      const [sbSeatPDA] = getSeatPDA(gameState.tablePDA, sbPos);
      const [bbSeatPDA] = getSeatPDA(gameState.tablePDA, bbPos);

      let tx: string;

      // Use atomic encrypted dealing when Inco privacy is enabled
      if (gameState.useIncoPrivacy) {
        console.log("Using deal_cards_encrypted for atomic Inco encryption (P0 security)");
        tx = await program.methods
          .dealCardsEncrypted()
          .accounts({
            caller: publicKey,
            table: gameState.tablePDA,
            handState: handPDA,
            deckState: deckPDA,
            sbSeat: sbSeatPDA,
            bbSeat: bbSeatPDA,
            incoProgram: INCO_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        // Cards are already encrypted - update state with hand number tracking
        const handNumber = gameState.table.handNumber.toNumber();
        setGameState((prev) => ({
          ...prev,
          areCardsEncrypted: true,
          encryptionHandNumber: handNumber,
        }));
        console.log("Cards dealt with atomic encryption - no plaintext exposure");
      } else {
        // Legacy plaintext dealing (not recommended for production)
        console.log("Using legacy deal_cards (WARNING: plaintext cards on-chain!)");
        tx = await program.methods
          .dealCards()
          .accounts({
            caller: publicKey,
            table: gameState.tablePDA,
            handState: handPDA,
            deckState: deckPDA,
            sbSeat: sbSeatPDA,
            bbSeat: bbSeatPDA,
          })
          .rpc();
      }

      await provider.connection.confirmTransaction(tx, "confirmed");
      await refreshState();
      return tx;
    } catch (e) {
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, provider, publicKey, gameState.tablePDA, gameState.table, gameState.useIncoPrivacy, refreshState]);

  // ============================================================
  // MagicBlock VRF: Request shuffle (initiates VRF randomness)
  // Modified Option B: Callback now handles shuffle + encrypt ATOMICALLY
  // VRF seed is NEVER stored - only used in memory during callback!
  // ============================================================
  const requestShuffle = useCallback(async (): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table) {
      throw new Error("Table not ready");
    }

    setLoading(true);
    setError(null);
    setGameState((prev) => ({ ...prev, isShuffling: true }));

    try {
      const handNumber = BigInt(gameState.table.handNumber.toNumber());
      const [handPDA] = getHandPDA(gameState.tablePDA, handNumber);
      const [deckPDA] = getDeckPDA(gameState.tablePDA, handNumber);

      // Build seat accounts for the callback (Modified Option B)
      // The callback will shuffle + encrypt atomically using these accounts
      const occupied = getOccupiedSeats(gameState.table.occupiedSeats);
      const seatAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
      for (const seatIndex of occupied) {
        const [seatPDA] = getSeatPDA(gameState.tablePDA!, seatIndex);
        seatAccounts.push({
          pubkey: seatPDA,
          isSigner: false,
          isWritable: true,
        });
      }

      console.log("MODIFIED OPTION B: Requesting VRF shuffle with atomic encrypt");
      console.log(`Passing ${seatAccounts.length} seat accounts to callback`);

      const tx = await program.methods
        .requestShuffle()
        .accounts({
          authority: publicKey,
          table: gameState.tablePDA,
          handState: handPDA,
          deckState: deckPDA,
          oracleQueue: DEFAULT_QUEUE,
          incoProgram: INCO_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(seatAccounts)
        .rpc();

      await provider.connection.confirmTransaction(tx, "confirmed");

      // Wait for VRF callback to complete shuffle + encrypt atomically
      console.log("VRF shuffle requested, waiting for oracle callback (atomic shuffle + encrypt)...");
      const shuffled = await waitForShuffle(provider.connection, deckPDA, 30000, 1000);

      if (shuffled) {
        console.log("ATOMIC shuffle + encrypt completed! Cards are now encrypted.");
        console.log("SECURITY: VRF seed was NEVER stored - only used in callback memory!");
        setGameState((prev) => ({ ...prev, isShuffling: false, isDeckShuffled: true }));
      } else {
        console.warn("VRF shuffle timed out");
        setGameState((prev) => ({ ...prev, isShuffling: false }));
        throw new Error("VRF shuffle timed out. The oracle may be busy.");
      }

      await refreshState();
      return tx;
    } catch (e) {
      setGameState((prev) => ({ ...prev, isShuffling: false }));
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, provider, publicKey, gameState.tablePDA, gameState.table, refreshState]);

  // ============================================================
  // DEPRECATED: MagicBlock VRF deal cards
  // With Modified Option B, the callback_shuffle now handles everything!
  // This function is kept for backwards compatibility only.
  // For new games: requestShuffle() does shuffle + encrypt atomically.
  // ============================================================
  const dealCardsVrf = useCallback(async (): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table) {
      throw new Error("Table not ready");
    }

    // With Modified Option B, requestShuffle handles everything
    // Check if cards are already dealt (callback did the work)
    if (gameState.isDeckShuffled && gameState.phase !== "Dealing") {
      console.log("DEPRECATED: Cards already dealt by atomic callback. Skipping.");
      return "already-dealt";
    }

    if (!gameState.isDeckShuffled) {
      throw new Error("VRF not complete yet. Call requestShuffle first - it now handles dealing!");
    }

    // Check if accounts are actually delegated (regardless of local state)
    const handNumber = BigInt(gameState.table.handNumber.toNumber());
    const [handPDA] = getHandPDA(gameState.tablePDA, handNumber);
    const isActuallyDelegated = await isAccountDelegatedByOwner(provider.connection, handPDA);

    // Use ER when accounts are actually delegated
    const useER = isActuallyDelegated && erProgram && erProvider;
    const activeProgram = useER ? erProgram : program;
    const activeProvider = useER ? erProvider : provider;

    if (useER) {
      console.log("Using Ephemeral Rollup for deal_cards_vrf (accounts are delegated)");
    } else if (gameState.isGameDelegated && !isActuallyDelegated) {
      console.warn("Local state says delegated but accounts are on base layer - using base layer");
      setGameState((prev) => ({ ...prev, isGameDelegated: false, isSeatDelegated: false }));
    }

    setLoading(true);
    setError(null);

    try {
      // handNumber and handPDA already derived above for delegation check
      const [deckPDA] = getDeckPDA(gameState.tablePDA, handNumber);

      // Find SB and BB positions
      const dealerPos = gameState.table.dealerPosition;
      const occupied = getOccupiedSeats(gameState.table.occupiedSeats, gameState.table.maxPlayers);
      const isHeadsUp = occupied.length === 2;

      const findNextOccupied = (startPos: number): number => {
        let pos = (startPos + 1) % gameState.table!.maxPlayers;
        while (!occupied.includes(pos)) {
          pos = (pos + 1) % gameState.table!.maxPlayers;
        }
        return pos;
      };

      let sbPos: number;
      let bbPos: number;

      if (isHeadsUp) {
        sbPos = dealerPos;
        bbPos = findNextOccupied(dealerPos);
      } else {
        sbPos = findNextOccupied(dealerPos);
        bbPos = findNextOccupied(sbPos);
      }

      const [sbSeatPDA] = getSeatPDA(gameState.tablePDA, sbPos);
      const [bbSeatPDA] = getSeatPDA(gameState.tablePDA, bbPos);

      // Build remaining accounts for other players (not SB/BB)
      const remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
      for (const seatIndex of occupied) {
        if (seatIndex !== sbPos && seatIndex !== bbPos) {
          const [seatPDA] = getSeatPDA(gameState.tablePDA!, seatIndex);
          remainingAccounts.push({
            pubkey: seatPDA,
            isSigner: false,
            isWritable: true,
          });
        }
      }

      const tx = await activeProgram.methods
        .dealCardsVrf()
        .accounts({
          authority: publicKey,
          table: gameState.tablePDA,
          handState: handPDA,
          deckState: deckPDA,
          sbSeat: sbSeatPDA,
          bbSeat: bbSeatPDA,
          incoProgram: INCO_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .rpc();

      await activeProvider.connection.confirmTransaction(tx, "confirmed");
      setGameState((prev) => ({ ...prev, isDeckShuffled: false })); // Reset for next hand
      await refreshState();
      return tx;
    } catch (e) {
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, provider, erProgram, erProvider, publicKey, gameState.tablePDA, gameState.table, gameState.isDeckShuffled, gameState.isSeatDelegated, refreshState]);

  // ============================================================
  // MagicBlock Delegation: Delegate seat to Ephemeral Rollup
  // ============================================================
  const delegateSeat = useCallback(async (): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || gameState.currentPlayerSeat === null) {
      throw new Error("Not at table");
    }

    setLoading(true);
    setError(null);

    try {
      const [seatPDA] = getSeatPDA(gameState.tablePDA, gameState.currentPlayerSeat);

      const tx = await program.methods
        .delegateSeat(gameState.currentPlayerSeat)
        .accounts({
          payer: publicKey,
          player: publicKey,
          table: gameState.tablePDA,
          seat: seatPDA,
        })
        .rpc();

      await provider.connection.confirmTransaction(tx, "confirmed");
      await refreshState();
      return tx;
    } catch (e) {
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, provider, publicKey, gameState.tablePDA, gameState.currentPlayerSeat, refreshState]);

  // ============================================================
  // MagicBlock Delegation: Undelegate seat from Ephemeral Rollup
  // ============================================================
  const undelegateSeat = useCallback(async (): Promise<string> => {
    // Use ER program for undelegation since the account is on ER
    if (!erProgram || !erProvider || !publicKey || !gameState.tablePDA || gameState.currentPlayerSeat === null) {
      throw new Error("Not at table or ER not available");
    }

    setLoading(true);
    setError(null);

    try {
      const [seatPDA] = getSeatPDA(gameState.tablePDA, gameState.currentPlayerSeat);

      const tx = await erProgram.methods
        .undelegateSeat()
        .accounts({
          payer: publicKey,
          table: gameState.tablePDA,
          seat: seatPDA,
        })
        .rpc();

      await erProvider.connection.confirmTransaction(tx, "confirmed");
      await refreshState();
      return tx;
    } catch (e) {
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [erProgram, erProvider, publicKey, gameState.tablePDA, gameState.currentPlayerSeat, refreshState]);

  // ============================================================
  // MagicBlock Delegation: Delegate hand state to Ephemeral Rollup
  // ============================================================
  const delegateHand = useCallback(async (): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table) {
      throw new Error("Table not ready");
    }

    setLoading(true);
    setError(null);

    try {
      const handNumber = BigInt(gameState.table.handNumber.toNumber());
      const [handPDA] = getHandPDA(gameState.tablePDA, handNumber);

      const tx = await program.methods
        .delegateHand()
        .accounts({
          payer: publicKey,
          authority: publicKey,
          table: gameState.tablePDA,
          handState: handPDA,
        })
        .rpc();

      await provider.connection.confirmTransaction(tx, "confirmed");
      console.log("Hand state delegated to ER:", tx);
      return tx;
    } catch (e) {
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, provider, publicKey, gameState.tablePDA, gameState.table]);

  // ============================================================
  // MagicBlock Delegation: Delegate deck state to Ephemeral Rollup
  // ============================================================
  const delegateDeck = useCallback(async (): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table) {
      throw new Error("Table not ready");
    }

    setLoading(true);
    setError(null);

    try {
      const handNumber = BigInt(gameState.table.handNumber.toNumber());
      const [deckPDA] = getDeckPDA(gameState.tablePDA, handNumber);

      const tx = await program.methods
        .delegateDeck()
        .accounts({
          payer: publicKey,
          authority: publicKey,
          table: gameState.tablePDA,
          deckState: deckPDA,
        })
        .rpc();

      await provider.connection.confirmTransaction(tx, "confirmed");
      console.log("Deck state delegated to ER:", tx);
      return tx;
    } catch (e) {
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, provider, publicKey, gameState.tablePDA, gameState.table]);

  // ============================================================
  // MagicBlock Delegation: Undelegate hand state from Ephemeral Rollup
  // ============================================================
  const undelegateHand = useCallback(async (): Promise<string> => {
    if (!erProgram || !erProvider || !publicKey || !gameState.tablePDA || !gameState.table) {
      throw new Error("Table not ready or ER not available");
    }

    setLoading(true);
    setError(null);

    try {
      const handNumber = BigInt(gameState.table.handNumber.toNumber());
      const [handPDA] = getHandPDA(gameState.tablePDA, handNumber);

      const tx = await erProgram.methods
        .undelegateHand()
        .accounts({
          payer: publicKey,
          table: gameState.tablePDA,
          handState: handPDA,
        })
        .rpc();

      await erProvider.connection.confirmTransaction(tx, "confirmed");
      console.log("Hand state undelegated from ER:", tx);
      return tx;
    } catch (e) {
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [erProgram, erProvider, publicKey, gameState.tablePDA, gameState.table]);

  // ============================================================
  // MagicBlock Delegation: Undelegate deck state from Ephemeral Rollup
  // ============================================================
  const undelegateDeck = useCallback(async (): Promise<string> => {
    if (!erProgram || !erProvider || !publicKey || !gameState.tablePDA || !gameState.table) {
      throw new Error("Table not ready or ER not available");
    }

    setLoading(true);
    setError(null);

    try {
      const handNumber = BigInt(gameState.table.handNumber.toNumber());
      const [deckPDA] = getDeckPDA(gameState.tablePDA, handNumber);

      const tx = await erProgram.methods
        .undelegateDeck()
        .accounts({
          payer: publicKey,
          table: gameState.tablePDA,
          deckState: deckPDA,
        })
        .rpc();

      await erProvider.connection.confirmTransaction(tx, "confirmed");
      console.log("Deck state undelegated from ER:", tx);
      return tx;
    } catch (e) {
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [erProgram, erProvider, publicKey, gameState.tablePDA, gameState.table]);

  // ============================================================
  // MagicBlock Delegation: Delegate ALL game state (hand + deck + seats)
  // This is the main function to enable privacy mode for a hand
  // ============================================================
  const delegateGameState = useCallback(async (): Promise<void> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table) {
      throw new Error("Table not ready");
    }

    console.log("Delegating all game state to Ephemeral Rollup...");
    setGameState((prev) => ({ ...prev, isDelegating: true }));

    try {
      // 1. Delegate hand state
      console.log("Step 1: Delegating hand state...");
      await delegateHand();

      // 2. Delegate deck state
      console.log("Step 2: Delegating deck state...");
      await delegateDeck();

      // 3. Delegate all occupied seats
      const occupied = getOccupiedSeats(gameState.table.occupiedSeats, gameState.table.maxPlayers);
      console.log(`Step 3: Delegating ${occupied.length} seats...`);

      for (const seatIndex of occupied) {
        const [seatPDA] = getSeatPDA(gameState.tablePDA!, seatIndex);

        const tx = await program.methods
          .delegateSeat(seatIndex)
          .accounts({
            payer: publicKey,
            player: publicKey,
            table: gameState.tablePDA,
            seat: seatPDA,
          })
          .rpc();

        await provider.connection.confirmTransaction(tx, "confirmed");
        console.log(`Seat ${seatIndex} delegated:`, tx);
      }

      console.log("All game state delegated successfully!");
      setGameState((prev) => ({
        ...prev,
        isDelegating: false,
        isGameDelegated: true,
        isSeatDelegated: true,
      }));
    } catch (e) {
      console.error("Failed to delegate game state:", e);
      setGameState((prev) => ({ ...prev, isDelegating: false }));
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    }
  }, [program, provider, publicKey, gameState.tablePDA, gameState.table, delegateHand, delegateDeck]);

  // ============================================================
  // MagicBlock Delegation: Undelegate ALL game state
  // Called after showdown to commit state back to base layer
  // ============================================================
  const undelegateGameState = useCallback(async (): Promise<void> => {
    if (!erProgram || !erProvider || !publicKey || !gameState.tablePDA || !gameState.table) {
      throw new Error("Table not ready or ER not available");
    }

    console.log("Undelegating all game state from Ephemeral Rollup...");
    setGameState((prev) => ({ ...prev, isUndelegating: true }));

    try {
      // 1. Undelegate all occupied seats
      const occupied = getOccupiedSeats(gameState.table.occupiedSeats, gameState.table.maxPlayers);
      console.log(`Step 1: Undelegating ${occupied.length} seats...`);

      for (const seatIndex of occupied) {
        const [seatPDA] = getSeatPDA(gameState.tablePDA!, seatIndex);

        try {
          // Get the seat account to get its bump
          const seatAccount = await erProvider.connection.getAccountInfo(seatPDA);
          if (seatAccount) {
            const tx = await erProgram.methods
              .undelegateSeat()
              .accounts({
                payer: publicKey,
                table: gameState.tablePDA,
                seat: seatPDA,
              })
              .rpc();

            await erProvider.connection.confirmTransaction(tx, "confirmed");
            console.log(`Seat ${seatIndex} undelegated:`, tx);
          }
        } catch (seatError) {
          console.warn(`Failed to undelegate seat ${seatIndex}:`, seatError);
          // Continue with other seats
        }
      }

      // 2. Undelegate deck state
      console.log("Step 2: Undelegating deck state...");
      try {
        await undelegateDeck();
      } catch (deckError) {
        console.warn("Failed to undelegate deck:", deckError);
      }

      // 3. Undelegate hand state
      console.log("Step 3: Undelegating hand state...");
      try {
        await undelegateHand();
      } catch (handError) {
        console.warn("Failed to undelegate hand:", handError);
      }

      console.log("All game state undelegated successfully!");

      // Wait for state to propagate to base layer
      await new Promise(resolve => setTimeout(resolve, 2000));

      setGameState((prev) => ({
        ...prev,
        isUndelegating: false,
        isGameDelegated: false,
        isSeatDelegated: false,
      }));

      await refreshState();
    } catch (e) {
      console.error("Failed to undelegate game state:", e);
      setGameState((prev) => ({ ...prev, isUndelegating: false }));
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    }
  }, [erProgram, erProvider, publicKey, gameState.tablePDA, gameState.table, undelegateHand, undelegateDeck, refreshState]);

  // ============================================================
  // Inco FHE: Phase 1 - Encrypt hole cards (stores handles)
  // ============================================================
  const encryptHoleCards = useCallback(async (seatIndex: number): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table) {
      throw new Error("Table not ready");
    }

    setLoading(true);
    setError(null);

    try {
      const handNumber = BigInt(gameState.table.handNumber.toNumber());
      const [handPDA] = getHandPDA(gameState.tablePDA, handNumber);
      const [seatPDA] = getSeatPDA(gameState.tablePDA, seatIndex);

      console.log(`Encrypting hole cards for seat ${seatIndex} via Inco FHE...`);

      const tx = await program.methods
        .encryptHoleCards(seatIndex)
        .accounts({
          authority: publicKey,
          table: gameState.tablePDA,
          handState: handPDA,
          playerSeat: seatPDA,
          incoProgram: INCO_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await provider.connection.confirmTransaction(tx, "confirmed");
      console.log("Phase 1 complete - cards encrypted:", tx);
      // NOTE: Don't call refreshState() here - let encryptAllPlayersCards handle it at the end
      // to avoid intermediate state confusion
      return tx;
    } catch (e) {
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, provider, publicKey, gameState.tablePDA, gameState.table]);

  // ============================================================
  // Inco FHE: Phase 2 - Grant decryption allowance
  // Must be called AFTER encryptHoleCards to have valid handles
  // ============================================================
  const grantCardAllowance = useCallback(async (seatIndex: number): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table) {
      throw new Error("Table not ready");
    }

    setLoading(true);
    setError(null);

    try {
      const [seatPDA] = getSeatPDA(gameState.tablePDA, seatIndex);

      // Fetch the seat to get the encrypted handles
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accounts = program.account as any;
      const seat = await accounts.playerSeat.fetch(seatPDA) as PlayerSeatAccount;

      const handle1 = BigInt(seat.holeCard1.toString());
      const handle2 = BigInt(seat.holeCard2.toString());

      // Verify cards are actually encrypted (handles > 51)
      if (handle1 <= BigInt(51) || handle2 <= BigInt(51)) {
        throw new Error("Cards not encrypted yet. Call encryptHoleCards first.");
      }

      // Derive allowance PDAs from the encrypted handles
      const [allowancePDA1] = getIncoAllowancePDA(handle1, seat.player);
      const [allowancePDA2] = getIncoAllowancePDA(handle2, seat.player);

      console.log(`Granting decryption allowances for seat ${seatIndex}...`);
      console.log(`  Handle 1: ${handle1.toString()}`);
      console.log(`  Handle 2: ${handle2.toString()}`);
      console.log(`  Allowance PDA 1: ${allowancePDA1.toString()}`);
      console.log(`  Allowance PDA 2: ${allowancePDA2.toString()}`);

      const tx = await program.methods
        .grantCardAllowance(seatIndex)
        .accounts({
          authority: publicKey,
          table: gameState.tablePDA,
          playerSeat: seatPDA,
          allowanceCard1: allowancePDA1,
          allowanceCard2: allowancePDA2,
          player: seat.player,
          incoProgram: INCO_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await provider.connection.confirmTransaction(tx, "confirmed");
      console.log("Phase 2 complete - allowances granted:", tx);
      // NOTE: Don't call refreshState() here - let encryptAllPlayersCards handle it at the end
      // to avoid intermediate state confusion
      return tx;
    } catch (e) {
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, provider, publicKey, gameState.tablePDA, gameState.table]);

  // ============================================================
  // Inco FHE: Combined helper - Encrypt + Grant in sequence
  // ============================================================
  const encryptAndGrantCards = useCallback(async (seatIndex: number): Promise<void> => {
    console.log(`Starting Inco encryption for seat ${seatIndex}...`);

    // Phase 1: Encrypt
    await encryptHoleCards(seatIndex);

    // Small delay to ensure state propagates
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Phase 2: Grant allowance
    await grantCardAllowance(seatIndex);

    console.log(`Inco encryption complete for seat ${seatIndex}!`);
  }, [encryptHoleCards, grantCardAllowance]);

  // ============================================================
  // Inco FHE: Encrypt all players' cards (after dealing)
  // Called automatically when useIncoPrivacy is enabled
  // ============================================================
  const encryptAllPlayersCards = useCallback(async (): Promise<void> => {
    if (!gameState.table || !gameState.tablePDA) {
      throw new Error("Table not ready");
    }

    const occupied = getOccupiedSeats(gameState.table.occupiedSeats, gameState.table.maxPlayers);
    console.log(`Encrypting cards for ${occupied.length} players via Inco FHE...`);

    setGameState((prev) => ({ ...prev, isEncrypting: true }));

    try {
      // Encrypt each player's cards sequentially
      for (const seatIndex of occupied) {
        console.log(`Encrypting seat ${seatIndex}...`);
        await encryptAndGrantCards(seatIndex);
        // Small delay between players to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log("All cards encrypted successfully!");
      // Track the hand number to prevent cross-hand state leakage
      const handNumber = gameState.table.handNumber.toNumber();
      setGameState((prev) => ({
        ...prev,
        isEncrypting: false,
        areCardsEncrypted: true,
        areAllowancesGranted: true,
        encryptionHandNumber: handNumber,
      }));

      // Small delay then refresh to sync UI with on-chain state
      await new Promise(resolve => setTimeout(resolve, 500));
      await refreshState();
    } catch (e) {
      console.error("Failed to encrypt all cards:", e);
      setGameState((prev) => ({ ...prev, isEncrypting: false }));
      throw e;
    }
  }, [gameState.table, gameState.tablePDA, encryptAndGrantCards, refreshState]);

  // ============================================================
  // Inco FHE: Grant allowances only (for atomic encryption)
  // When cards are encrypted during deal_cards_encrypted, we still need
  // to grant allowances for players to decrypt their own cards
  // ============================================================
  const grantAllPlayersAllowances = useCallback(async (): Promise<void> => {
    if (!gameState.table || !gameState.tablePDA) {
      throw new Error("Table not ready");
    }

    const occupied = getOccupiedSeats(gameState.table.occupiedSeats, gameState.table.maxPlayers);
    console.log(`Granting decryption allowances for ${occupied.length} players...`);

    setGameState((prev) => ({ ...prev, isEncrypting: true })); // Reuse isEncrypting for progress

    try {
      // Grant allowance for each player's cards sequentially
      for (const seatIndex of occupied) {
        console.log(`Granting allowance for seat ${seatIndex}...`);
        await grantCardAllowance(seatIndex);
        // Small delay between players to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log("All allowances granted successfully!");
      // Track the hand number to prevent cross-hand state leakage
      const handNumber = gameState.table.handNumber.toNumber();
      setGameState((prev) => ({
        ...prev,
        isEncrypting: false,
        areAllowancesGranted: true,
        encryptionHandNumber: handNumber,
      }));

      // Small delay then refresh to sync UI with on-chain state
      await new Promise(resolve => setTimeout(resolve, 500));
      await refreshState();
    } catch (e) {
      console.error("Failed to grant allowances:", e);
      setGameState((prev) => ({ ...prev, isEncrypting: false }));
      throw e;
    }
  }, [gameState.table, gameState.tablePDA, grantCardAllowance, refreshState]);

  // ============================================================
  // Inco FHE: Decrypt own cards (client-side)
  // Uses Inco SDK to decrypt encrypted handles with wallet signing
  // ============================================================
  const decryptMyCards = useCallback(async (): Promise<void> => {
    if (!program || !publicKey || !signMessage || !gameState.tablePDA || gameState.currentPlayerSeat === null) {
      throw new Error("Not ready to decrypt - wallet not connected or not at table");
    }

    console.log("Starting Inco decryption for your cards...");
    setGameState((prev) => ({ ...prev, isDecrypting: true }));

    try {
      // Fetch current player's seat to get encrypted handles
      const [seatPDA] = getSeatPDA(gameState.tablePDA, gameState.currentPlayerSeat);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accounts = program.account as any;
      const seat = await accounts.playerSeat.fetch(seatPDA) as PlayerSeatAccount;

      // Get encrypted handles as BigInt
      const handle1 = BigInt(seat.holeCard1.toString());
      const handle2 = BigInt(seat.holeCard2.toString());

      // Verify cards are encrypted (handles > 51)
      if (handle1 <= BigInt(51) || handle2 <= BigInt(51)) {
        throw new Error("Cards are not encrypted - nothing to decrypt");
      }

      console.log("Encrypted handles:", handle1.toString(), handle2.toString());
      console.log("Calling Inco SDK to decrypt...");

      // Call Inco SDK to decrypt (requires wallet signature for authentication)
      const plaintexts = await decryptCards(
        [handle1, handle2],
        { publicKey, signMessage }
      );

      // Validate we got both cards
      if (plaintexts.length < 2) {
        console.error(`Expected 2 decrypted cards, got ${plaintexts.length}`);
      }

      // Use null for missing cards (defensive coding)
      const card1 = plaintexts[0] ?? null;
      const card2 = plaintexts[1] ?? null;

      // Update state with decrypted cards
      setGameState((prev) => ({
        ...prev,
        isDecrypting: false,
        decryptedCards: [card1, card2],
      }));

      console.log("Cards decrypted successfully:", card1, card2);
    } catch (e) {
      console.error("Failed to decrypt cards:", e);
      setGameState((prev) => ({ ...prev, isDecrypting: false }));
      throw e;
    }
  }, [program, publicKey, signMessage, gameState.tablePDA, gameState.currentPlayerSeat]);

  // Reveal cards for showdown (submits decrypted cards to blockchain)
  // Note: Full Ed25519 verification from Inco is implemented in the program,
  // but we allow reveal without verification for testing
  const revealCards = useCallback(async (): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table || gameState.currentPlayerSeat === null) {
      throw new Error("Not ready to reveal - wallet not connected or not at table");
    }

    // Check if we have decrypted cards
    const [card1, card2] = gameState.decryptedCards;
    if (card1 === null || card2 === null) {
      throw new Error("Must decrypt cards before revealing");
    }

    console.log("Revealing cards for showdown:", card1, card2);
    setGameState((prev) => ({ ...prev, isRevealing: true }));

    try {
      const handNumber = BigInt(gameState.table.handNumber.toNumber());
      const [seatPDA] = getSeatPDA(gameState.tablePDA, gameState.currentPlayerSeat);
      const [handPDA] = getHandPDA(gameState.tablePDA, handNumber);

      // Call reveal_cards instruction
      // Note: In production, this should include Ed25519 verification instructions
      // For now, the program allows reveal without verification for testing
      const tx = await program.methods
        .revealCards(card1, card2)
        .accounts({
          player: publicKey,
          table: gameState.tablePDA,
          handState: handPDA,
          playerSeat: seatPDA,
          instructionsSysvar: new PublicKey("Sysvar1nstructions1111111111111111111111111"),
        })
        .rpc();

      console.log("Cards revealed on-chain:", tx);
      setGameState((prev) => ({ ...prev, isRevealing: false }));

      // State will be refreshed by polling
      return tx;
    } catch (e) {
      console.error("Failed to reveal cards:", e);
      setGameState((prev) => ({ ...prev, isRevealing: false }));
      throw e;
    }
  }, [program, provider, publicKey, gameState.tablePDA, gameState.table, gameState.currentPlayerSeat, gameState.decryptedCards]);

  // ============================================================
  // Game Liveness: Self-grant allowance after timeout
  // ============================================================
  const grantOwnAllowance = useCallback(async (): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table || gameState.currentPlayerSeat === null) {
      throw new Error("Not ready - wallet not connected or not at table");
    }

    setLoading(true);
    setError(null);

    try {
      const handNumber = BigInt(gameState.table.handNumber.toNumber());
      const [handPDA] = getHandPDA(gameState.tablePDA, handNumber);
      const [seatPDA] = getSeatPDA(gameState.tablePDA, gameState.currentPlayerSeat);

      // Fetch seat to get encrypted handles
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accounts = program.account as any;
      const seat = await accounts.playerSeat.fetch(seatPDA) as PlayerSeatAccount;

      const handle1 = BigInt(seat.holeCard1.toString());
      const handle2 = BigInt(seat.holeCard2.toString());

      // Verify cards are encrypted
      if (handle1 <= BigInt(255) || handle2 <= BigInt(255)) {
        throw new Error("Cards not encrypted - nothing to grant allowance for");
      }

      // Derive allowance PDAs
      const [allowancePDA1] = getIncoAllowancePDA(handle1, publicKey);
      const [allowancePDA2] = getIncoAllowancePDA(handle2, publicKey);

      console.log("Self-granting allowance after timeout...");

      const tx = await program.methods
        .grantOwnAllowance(gameState.currentPlayerSeat)
        .accounts({
          player: publicKey,
          table: gameState.tablePDA,
          handState: handPDA,
          playerSeat: seatPDA,
          allowanceCard1: allowancePDA1,
          allowanceCard2: allowancePDA2,
          incoProgram: INCO_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await provider.connection.confirmTransaction(tx, "confirmed");
      console.log("Self-granted allowance:", tx);

      // Update state
      setGameState((prev) => ({
        ...prev,
        areAllowancesGranted: true,
        encryptionHandNumber: gameState.table!.handNumber.toNumber(),
      }));

      await refreshState();
      return tx;
    } catch (e) {
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, provider, publicKey, gameState.tablePDA, gameState.table, gameState.currentPlayerSeat, refreshState]);

  // ============================================================
  // Game Liveness: Timeout reveal - muck non-revealing player
  // ============================================================
  const timeoutReveal = useCallback(async (targetSeat: number): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table) {
      throw new Error("Not ready - wallet not connected or no table");
    }

    setLoading(true);
    setError(null);

    try {
      const handNumber = BigInt(gameState.table.handNumber.toNumber());
      const [handPDA] = getHandPDA(gameState.tablePDA, handNumber);
      const [targetSeatPDA] = getSeatPDA(gameState.tablePDA, targetSeat);

      console.log(`Timing out player at seat ${targetSeat} for not revealing cards...`);

      const tx = await program.methods
        .timeoutReveal(targetSeat)
        .accounts({
          caller: publicKey,
          table: gameState.tablePDA,
          handState: handPDA,
          targetPlayer: targetSeatPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await provider.connection.confirmTransaction(tx, "confirmed");
      console.log("Player timed out and mucked:", tx);

      await refreshState();
      return tx;
    } catch (e) {
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, provider, publicKey, gameState.tablePDA, gameState.table, refreshState]);

  // ============================================================
  // Game Liveness: Close inactive table and return funds
  // ============================================================
  const closeInactiveTable = useCallback(async (): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table) {
      throw new Error("Not ready - wallet not connected or no table");
    }

    setLoading(true);
    setError(null);

    try {
      const [vaultPDA] = getVaultPDA(gameState.tablePDA);

      // Build remaining accounts: [seat, wallet, seat, wallet, ...]
      const remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];

      for (const player of gameState.players) {
        if (player.status !== "empty" && player.player) {
          const [seatPDA] = getSeatPDA(gameState.tablePDA, player.seatIndex);
          remainingAccounts.push(
            { pubkey: seatPDA, isSigner: false, isWritable: true },
            { pubkey: new PublicKey(player.player), isSigner: false, isWritable: true }
          );
        }
      }

      console.log(`Closing inactive table, returning funds to ${remainingAccounts.length / 2} players...`);

      const tx = await program.methods
        .closeInactiveTable()
        .accounts({
          caller: publicKey,
          table: gameState.tablePDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .rpc();

      await provider.connection.confirmTransaction(tx, "confirmed");
      console.log("Table closed and funds returned:", tx);

      // Clear local state
      setGameState((prev) => ({
        ...prev,
        tableStatus: "Closed",
        players: [],
      }));

      return tx;
    } catch (e) {
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, provider, publicKey, gameState.tablePDA, gameState.table, gameState.players]);

  // Player action (routes through ER when delegated for low latency)
  const playerAction = useCallback(
    async (action: ActionType): Promise<string> => {
      if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table || gameState.currentPlayerSeat === null) {
        throw new Error("Not at table");
      }

      // Check if accounts are actually delegated (regardless of local state)
      const handNumber = BigInt(gameState.table.handNumber.toNumber());
      const [handPDA] = getHandPDA(gameState.tablePDA, handNumber);
      const isActuallyDelegated = await isAccountDelegatedByOwner(provider.connection, handPDA);

      // Use ER when accounts are actually delegated
      const useER = isActuallyDelegated && erProgram && erProvider;
      const activeProgram = useER ? erProgram : program;
      const activeProvider = useER ? erProvider : provider;

      if (useER) {
        console.log("Using Ephemeral Rollup for player action (accounts are delegated)");
      } else if (gameState.isGameDelegated && !isActuallyDelegated) {
        console.warn("Local state says delegated but accounts are on base layer - using base layer");
        setGameState((prev) => ({ ...prev, isGameDelegated: false, isSeatDelegated: false }));
      }

      setLoading(true);
      setError(null);

      try {
        // handNumber and handPDA already derived above
        const [deckPDA] = getDeckPDA(gameState.tablePDA, handNumber);
        const [seatPDA] = getSeatPDA(gameState.tablePDA, gameState.currentPlayerSeat);

        // Build action argument
        let actionArg: object;
        switch (action.type) {
          case "fold":
            actionArg = { fold: {} };
            break;
          case "check":
            actionArg = { check: {} };
            break;
          case "call":
            actionArg = { call: {} };
            break;
          case "raise":
            actionArg = { raise: { amount: new BN(action.amount) } };
            break;
          case "allIn":
            actionArg = { allIn: {} };
            break;
        }

        const tx = await activeProgram.methods
          .playerAction(actionArg)
          .accounts({
            player: publicKey,
            table: gameState.tablePDA,
            handState: handPDA,
            deckState: deckPDA,
            playerSeat: seatPDA,
          })
          .rpc();

        await activeProvider.connection.confirmTransaction(tx, "confirmed");
        await refreshState();
        return tx;
      } catch (e) {
        const message = parseAnchorError(e);
        setError(message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [program, provider, erProgram, erProvider, publicKey, gameState.tablePDA, gameState.table, gameState.currentPlayerSeat, gameState.isSeatDelegated, refreshState]
  );

  // Showdown (authority can call immediately, anyone else after timeout)
  // IMPORTANT: Showdown writes to table (sets status to Waiting), so it MUST run on base layer
  // If game is delegated, we auto-undelegate first to commit state back to base layer
  const showdown = useCallback(async (): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table) {
      throw new Error("Table not ready");
    }

    setLoading(true);
    setError(null);

    try {
      // If game is delegated, undelegate first since showdown writes to table
      // Table is NOT delegated, so showdown MUST run on base layer
      if (gameState.isGameDelegated && erProgram && erProvider) {
        console.log("Game is delegated - undelegating before showdown (showdown writes to table)");

        // Undelegate all game state
        const occupied = getOccupiedSeats(gameState.table.occupiedSeats, gameState.table.maxPlayers);
        console.log(`Undelegating ${occupied.length} seats, hand state, and deck state...`);

        // 1. Undelegate all seats
        for (const seatIndex of occupied) {
          const [seatPDA] = getSeatPDA(gameState.tablePDA!, seatIndex);
          try {
            const seatAccount = await erProvider.connection.getAccountInfo(seatPDA);
            if (seatAccount) {
              const tx = await erProgram.methods
                .undelegateSeat()
                .accounts({
                  payer: publicKey,
                  table: gameState.tablePDA,
                  seat: seatPDA,
                })
                .rpc();
              await erProvider.connection.confirmTransaction(tx, "confirmed");
              console.log(`Seat ${seatIndex} undelegated`);
            }
          } catch (seatError) {
            console.warn(`Failed to undelegate seat ${seatIndex}:`, seatError);
          }
        }

        // 2. Undelegate deck
        try {
          const handNumber = BigInt(gameState.table.handNumber.toNumber());
          const [deckPDA] = getDeckPDA(gameState.tablePDA, handNumber);
          const tx = await erProgram.methods
            .undelegateDeck()
            .accounts({
              payer: publicKey,
              authority: publicKey,
              table: gameState.tablePDA,
              deckState: deckPDA,
            })
            .rpc();
          await erProvider.connection.confirmTransaction(tx, "confirmed");
          console.log("Deck state undelegated");
        } catch (deckError) {
          console.warn("Failed to undelegate deck:", deckError);
        }

        // 3. Undelegate hand
        try {
          const handNumber = BigInt(gameState.table.handNumber.toNumber());
          const [handPDA] = getHandPDA(gameState.tablePDA, handNumber);
          const tx = await erProgram.methods
            .undelegateHand()
            .accounts({
              payer: publicKey,
              authority: publicKey,
              table: gameState.tablePDA,
              handState: handPDA,
            })
            .rpc();
          await erProvider.connection.confirmTransaction(tx, "confirmed");
          console.log("Hand state undelegated");
        } catch (handError) {
          console.warn("Failed to undelegate hand:", handError);
        }

        // Wait for state to propagate to base layer
        console.log("Waiting for state to propagate to base layer...");
        await new Promise(resolve => setTimeout(resolve, 3000));

        setGameState((prev) => ({
          ...prev,
          isGameDelegated: false,
          isSeatDelegated: false,
        }));
      }

      // Always run showdown on base layer
      const handNumber = BigInt(gameState.table.handNumber.toNumber());
      const [handPDA] = getHandPDA(gameState.tablePDA, handNumber);
      const [vaultPDA] = getVaultPDA(gameState.tablePDA);

      // Get all player seat PDAs as remaining accounts
      const occupied = getOccupiedSeats(gameState.table.occupiedSeats, gameState.table.maxPlayers);
      const remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];

      for (const seatIndex of occupied) {
        const [seatPDA] = getSeatPDA(gameState.tablePDA!, seatIndex);
        try {
          const accountInfo = await provider.connection.getAccountInfo(seatPDA);
          if (accountInfo && accountInfo.data.length > 0) {
            remainingAccounts.push({
              pubkey: seatPDA,
              isSigner: false,
              isWritable: true,
            });
          }
        } catch {
          console.warn(`Seat ${seatIndex} account not found, skipping`);
        }
      }

      console.log("Running showdown on base layer...");
      const tx = await program.methods
        .showdown()
        .accounts({
          caller: publicKey,
          table: gameState.tablePDA,
          handState: handPDA,
          vault: vaultPDA,
        })
        .remainingAccounts(remainingAccounts)
        .rpc();

      await provider.connection.confirmTransaction(tx, "confirmed");
      await refreshState();
      return tx;
    } catch (e) {
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, provider, erProgram, erProvider, publicKey, gameState.tablePDA, gameState.table, gameState.isGameDelegated, refreshState]);

  // Timeout a player who hasn't acted in time (anyone can call)
  // Routes through ER when seats are delegated
  const timeoutPlayer = useCallback(async (): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table || !gameState.handState) {
      throw new Error("Table not ready");
    }

    // Check if accounts are actually delegated (regardless of local state)
    const handNumber = BigInt(gameState.table.handNumber.toNumber());
    const [handPDA] = getHandPDA(gameState.tablePDA, handNumber);
    const isActuallyDelegated = await isAccountDelegatedByOwner(provider.connection, handPDA);

    // Use ER when accounts are actually delegated
    const useER = isActuallyDelegated && erProgram && erProvider;
    const activeProgram = useER ? erProgram : program;
    const activeProvider = useER ? erProvider : provider;

    if (useER) {
      console.log("Using Ephemeral Rollup for timeout_player (accounts are delegated)");
    } else if (gameState.isGameDelegated && !isActuallyDelegated) {
      console.warn("Local state says delegated but accounts are on base layer - using base layer");
      setGameState((prev) => ({ ...prev, isGameDelegated: false, isSeatDelegated: false }));
    }

    setLoading(true);
    setError(null);

    try {
      // handNumber and handPDA already derived above
      const [deckPDA] = getDeckPDA(gameState.tablePDA, handNumber);

      // Get the seat of the player whose turn it is
      const actionOn = gameState.handState.actionOn;
      const [timedOutSeatPDA] = getSeatPDA(gameState.tablePDA, actionOn);

      const tx = await activeProgram.methods
        .timeoutPlayer()
        .accounts({
          caller: publicKey,
          table: gameState.tablePDA,
          handState: handPDA,
          deckState: deckPDA,
          playerSeat: timedOutSeatPDA,
        })
        .rpc();

      await activeProvider.connection.confirmTransaction(tx, "confirmed");
      await refreshState();
      return tx;
    } catch (e) {
      const message = parseAnchorError(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, provider, erProgram, erProvider, publicKey, gameState.tablePDA, gameState.table, gameState.handState, gameState.isSeatDelegated, refreshState]);

  return {
    gameState,
    loading,
    error,
    createTable,
    joinTable,
    leaveTable,
    startHand,
    dealCards,
    playerAction,
    showdown,
    timeoutPlayer,
    // MagicBlock VRF
    requestShuffle,
    dealCardsVrf,
    // MagicBlock Delegation
    delegateSeat,
    delegateHand,
    delegateDeck,
    delegateGameState,
    undelegateSeat,
    undelegateHand,
    undelegateDeck,
    undelegateGameState,
    // Inco FHE Encryption
    encryptHoleCards,
    grantCardAllowance,
    encryptAndGrantCards,
    encryptAllPlayersCards,
    grantAllPlayersAllowances,
    decryptMyCards,
    revealCards,
    // Game Liveness (prevent stuck games)
    grantOwnAllowance,
    timeoutReveal,
    closeInactiveTable,
    // Utilities
    refreshState,
    setTableId,
    setUseVrf,
    setUsePrivacyMode,
    setUseIncoPrivacy,
    checkDelegationStatus,
  };
}

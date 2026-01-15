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
import {
  mapPlayerStatus,
  mapGamePhase,
  mapTableStatus,
  getOccupiedSeats,
  parseAnchorError,
} from "@/lib/utils";

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
  status: { sitting?: object; playing?: object; folded?: object; allIn?: object };
  hasActed: boolean;
  bump: number;
}

export interface DeckStateAccount {
  hand: PublicKey;
  cards: BN[];
  dealIndex: number;
  isShuffled: boolean;
  vrfSeed: number[]; // 32 bytes
  seedReceived: boolean; // VRF seed received, ready for shuffle on ER
  bump: number;
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
  usePrivacyMode: boolean; // Whether to auto-delegate for privacy
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

  // Utilities
  refreshState: () => Promise<void>;
  setTableId: (tableId: string) => void;
  setUseVrf: (useVrf: boolean) => void;
  setUsePrivacyMode: (usePrivacy: boolean) => void;
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
};

export function usePokerGame(): UsePokerGameResult {
  const { program, provider, publicKey, erProgram, erProvider, erConnection } = usePokerProgram();
  const [gameState, setGameState] = useState<GameState>(initialGameState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Toggle VRF mode
  const setUseVrf = useCallback((useVrf: boolean) => {
    setGameState((prev) => ({ ...prev, useVrf }));
  }, []);

  // Toggle Privacy mode (auto-delegation)
  const setUsePrivacyMode = useCallback((usePrivacyMode: boolean) => {
    setGameState((prev) => ({ ...prev, usePrivacyMode }));
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

            // Convert hole cards - only show if current player
            const isCurrentPlayer = publicKey?.equals(seat.player);
            const holeCard1 = seat.holeCard1.toNumber();
            const holeCard2 = seat.holeCard2.toNumber();

            // Check if cards have been dealt - card value 255 means not dealt
            // Cards remain valid through showdown and settlement for hand evaluation
            const hasValidCards = holeCard1 !== 255 && holeCard2 !== 255 &&
                                  holeCard1 >= 0 && holeCard1 <= 51 &&
                                  holeCard2 >= 0 && holeCard2 <= 51;

            players.push({
              seatIndex: seat.seatIndex,
              player: seat.player.toString(),
              chips: seat.chips.toNumber(),
              currentBet: seat.totalBetThisHand.toNumber(), // Use total bet this hand, not per-round
              // Show cards if: current player AND cards are valid (0-51, not 255)
              // This allows seeing cards during showdown and settlement for hand evaluation
              holeCards: isCurrentPlayer && hasValidCards
                ? [holeCard1, holeCard2]
                : [null, null],
              status: mapPlayerStatus(seat.status),
              isActive: hasValidCards,
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
    const useER = (detectedDelegation || gameState.isGameDelegated) && erProgram;
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
        // seedReceived means VRF callback completed and deck is ready for dealing on ER
        isDeckShuffled: deckState?.seedReceived ?? false,
        // Auto-update delegation status based on detection
        // Reset to false when table is Waiting (hand is over), otherwise preserve/detect
        isGameDelegated: tableStatus === "Waiting" ? false : (detectedDelegation || gameState.isGameDelegated),
        isSeatDelegated: tableStatus === "Waiting" ? false : (detectedDelegation || gameState.isSeatDelegated),
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

      const tx = await program.methods
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

  // ============================================================
  // MagicBlock VRF: Request shuffle (initiates VRF randomness)
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

      const tx = await program.methods
        .requestShuffle()
        .accounts({
          authority: publicKey,
          table: gameState.tablePDA,
          handState: handPDA,
          deckState: deckPDA,
          oracleQueue: DEFAULT_QUEUE,
        })
        .rpc();

      await provider.connection.confirmTransaction(tx, "confirmed");

      // Wait for VRF callback to complete the shuffle
      console.log("VRF shuffle requested, waiting for oracle callback...");
      const shuffled = await waitForShuffle(provider.connection, deckPDA, 30000, 1000);

      if (shuffled) {
        console.log("VRF shuffle completed!");
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
  // MagicBlock VRF: Deal cards after VRF shuffle
  // Routes through ER when seats are delegated for privacy
  // ============================================================
  const dealCardsVrf = useCallback(async (): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table) {
      throw new Error("Table not ready");
    }

    if (!gameState.isDeckShuffled) {
      throw new Error("VRF seed not received yet. Call requestShuffle first.");
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
    // Utilities
    refreshState,
    setTableId,
    setUseVrf,
    setUsePrivacyMode,
    checkDelegationStatus,
  };
}

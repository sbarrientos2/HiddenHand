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

// UI-friendly types
export interface Player {
  seatIndex: number;
  player: string;
  chips: number;
  currentBet: number;
  holeCards: [number | null, number | null];
  status: "empty" | "sitting" | "playing" | "folded" | "allin";
  isActive: boolean;
}

export interface GameState {
  tableId: string;
  tablePDA: PublicKey | null;
  table: TableAccount | null;
  handState: HandStateAccount | null;
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

  // Utilities
  refreshState: () => Promise<void>;
  setTableId: (tableId: string) => void;
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
};

export function usePokerGame(): UsePokerGameResult {
  const { program, provider, publicKey } = usePokerProgram();
  const [gameState, setGameState] = useState<GameState>(initialGameState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

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
  const fetchPlayerSeats = useCallback(
    async (tablePDA: PublicKey, maxPlayers: number, occupiedSeats: number): Promise<Player[]> => {
      if (!program) return [];

      const players: Player[] = [];
      const occupied = getOccupiedSeats(occupiedSeats, maxPlayers);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accounts = program.account as any;

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
    [program, publicKey]
  );

  // Refresh all game state
  const refreshState = useCallback(async () => {
    if (!program || !gameState.tablePDA) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = program.account as any;

    try {
      // Fetch table account
      let table: TableAccount;
      try {
        table = await accounts.table.fetch(gameState.tablePDA) as TableAccount;
      } catch (e) {
        // Table doesn't exist
        setGameState((prev) => ({
          ...prev,
          table: null,
          tableStatus: "Waiting",
        }));
        return;
      }

      const tableStatus = mapTableStatus(table.status);
      const isAuthority = publicKey?.equals(table.authority) ?? false;

      // Fetch player seats
      const players = await fetchPlayerSeats(
        gameState.tablePDA,
        table.maxPlayers,
        table.occupiedSeats
      );

      // Find current player's seat
      const currentPlayerSeat = players.find(
        (p) => p.player === publicKey?.toString()
      )?.seatIndex ?? null;

      // Fetch hand state if playing
      let handState: HandStateAccount | null = null;
      if (tableStatus === "Playing" && table.handNumber.toNumber() > 0) {
        try {
          const [handPDA] = getHandPDA(gameState.tablePDA, BigInt(table.handNumber.toNumber()));
          handState = await accounts.handState.fetch(handPDA) as HandStateAccount;
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
      }));

      setError(null);
    } catch (e) {
      console.error("Error refreshing state:", e);
      setError(e instanceof Error ? e.message : "Failed to fetch game state");
    }
  }, [program, gameState.tablePDA, publicKey, fetchPlayerSeats]);

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

  // Join table
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
    [program, provider, publicKey, gameState.tablePDA, gameState.table, refreshState]
  );

  // Leave table
  const leaveTable = useCallback(async (): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || gameState.currentPlayerSeat === null) {
      throw new Error("Not at table");
    }

    setLoading(true);
    setError(null);

    try {
      const [seatPDA] = getSeatPDA(gameState.tablePDA, gameState.currentPlayerSeat);
      const [vaultPDA] = getVaultPDA(gameState.tablePDA);

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

  // Deal cards (authority can call immediately, anyone else after timeout)
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

  // Player action
  const playerAction = useCallback(
    async (action: ActionType): Promise<string> => {
      if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table || gameState.currentPlayerSeat === null) {
        throw new Error("Not at table");
      }

      setLoading(true);
      setError(null);

      try {
        const handNumber = BigInt(gameState.table.handNumber.toNumber());
        const [handPDA] = getHandPDA(gameState.tablePDA, handNumber);
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

        const tx = await program.methods
          .playerAction(actionArg)
          .accounts({
            player: publicKey,
            table: gameState.tablePDA,
            handState: handPDA,
            deckState: deckPDA,
            playerSeat: seatPDA,
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
    },
    [program, provider, publicKey, gameState.tablePDA, gameState.table, gameState.currentPlayerSeat, refreshState]
  );

  // Showdown (authority can call immediately, anyone else after timeout)
  const showdown = useCallback(async (): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table) {
      throw new Error("Table not ready");
    }

    setLoading(true);
    setError(null);

    try {
      const handNumber = BigInt(gameState.table.handNumber.toNumber());
      const [handPDA] = getHandPDA(gameState.tablePDA, handNumber);
      const [vaultPDA] = getVaultPDA(gameState.tablePDA);

      // Get all player seat PDAs as remaining accounts
      // Only include seats that actually exist on-chain
      const occupied = getOccupiedSeats(gameState.table.occupiedSeats, gameState.table.maxPlayers);
      const remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];

      for (const seatIndex of occupied) {
        const [seatPDA] = getSeatPDA(gameState.tablePDA!, seatIndex);
        // Verify the account exists before adding
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
          // Skip accounts that don't exist
          console.warn(`Seat ${seatIndex} account not found, skipping`);
        }
      }

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

      // Wait for confirmation before refreshing state
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

  // Timeout a player who hasn't acted in time (anyone can call)
  const timeoutPlayer = useCallback(async (): Promise<string> => {
    if (!program || !provider || !publicKey || !gameState.tablePDA || !gameState.table || !gameState.handState) {
      throw new Error("Table not ready");
    }

    setLoading(true);
    setError(null);

    try {
      const handNumber = BigInt(gameState.table.handNumber.toNumber());
      const [handPDA] = getHandPDA(gameState.tablePDA, handNumber);
      const [deckPDA] = getDeckPDA(gameState.tablePDA, handNumber);

      // Get the seat of the player whose turn it is
      const actionOn = gameState.handState.actionOn;
      const [timedOutSeatPDA] = getSeatPDA(gameState.tablePDA, actionOn);

      const tx = await program.methods
        .timeoutPlayer()
        .accounts({
          caller: publicKey,
          table: gameState.tablePDA,
          handState: handPDA,
          deckState: deckPDA,
          playerSeat: timedOutSeatPDA,
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
  }, [program, provider, publicKey, gameState.tablePDA, gameState.table, gameState.handState, refreshState]);

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
    refreshState,
    setTableId,
  };
}

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
  lastActionSlot: BN;
  handStartSlot: BN;
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

            // Check if cards have been dealt (status is Playing or AllIn means cards are dealt)
            const hasCards = seat.status.playing !== undefined || seat.status.allIn !== undefined;

            players.push({
              seatIndex: seat.seatIndex,
              player: seat.player.toString(),
              chips: seat.chips.toNumber(),
              currentBet: seat.currentBet.toNumber(),
              // Show cards if: current player AND cards have been dealt
              // Note: card value 0 is valid (2 of Hearts), so don't use || null
              holeCards: isCurrentPlayer && hasCards
                ? [holeCard1, holeCard2]
                : [null, null],
              status: mapPlayerStatus(seat.status),
              isActive: hasCards,
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
      const communityCards = handState?.communityCards ?? [];

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
        const message = e instanceof Error ? e.message : "Failed to create table";
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

        await refreshState();
        return tx;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to join table";
        setError(message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [program, provider, publicKey, gameState.tablePDA, refreshState]
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

      await refreshState();
      return tx;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to leave table";
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
          authority: publicKey,
          table: gameState.tablePDA,
          handState: handPDA,
          deckState: deckPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await refreshState();
      return tx;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to start hand";
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, provider, publicKey, gameState.tablePDA, gameState.table, refreshState]);

  // Deal cards (authority only)
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

      // Find next occupied seats after dealer for SB and BB
      const findNextOccupied = (startPos: number, skip: number): number => {
        let found = 0;
        let pos = startPos;
        while (found <= skip) {
          pos = (pos + 1) % gameState.table!.maxPlayers;
          if (occupied.includes(pos)) {
            found++;
          }
        }
        return pos;
      };

      const sbPos = findNextOccupied(dealerPos, 0);
      const bbPos = findNextOccupied(dealerPos, 1);

      const [sbSeatPDA] = getSeatPDA(gameState.tablePDA, sbPos);
      const [bbSeatPDA] = getSeatPDA(gameState.tablePDA, bbPos);

      const tx = await program.methods
        .dealCards()
        .accounts({
          authority: publicKey,
          table: gameState.tablePDA,
          handState: handPDA,
          deckState: deckPDA,
          sbSeat: sbSeatPDA,
          bbSeat: bbSeatPDA,
        })
        .rpc();

      await refreshState();
      return tx;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to deal cards";
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

        await refreshState();
        return tx;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Action failed";
        setError(message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [program, provider, publicKey, gameState.tablePDA, gameState.table, gameState.currentPlayerSeat, refreshState]
  );

  // Showdown (authority only)
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
      const occupied = getOccupiedSeats(gameState.table.occupiedSeats, gameState.table.maxPlayers);
      const remainingAccounts = occupied.map((seatIndex) => {
        const [seatPDA] = getSeatPDA(gameState.tablePDA!, seatIndex);
        return {
          pubkey: seatPDA,
          isSigner: false,
          isWritable: true,
        };
      });

      const tx = await program.methods
        .showdown()
        .accounts({
          authority: publicKey,
          table: gameState.tablePDA,
          handState: handPDA,
          vault: vaultPDA,
        })
        .remainingAccounts(remainingAccounts)
        .rpc();

      await refreshState();
      return tx;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Showdown failed";
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [program, provider, publicKey, gameState.tablePDA, gameState.table, refreshState]);

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
    refreshState,
    setTableId,
  };
}

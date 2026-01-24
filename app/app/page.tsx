"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletButton } from "@/components/WalletButton";
import { PokerTable } from "@/components/PokerTable";
import { ActionPanel } from "@/components/ActionPanel";
import { useState, useEffect, useRef, useMemo } from "react";
import { usePokerGame, type ActionType } from "@/hooks/usePokerGame";
import { ActionTimer } from "@/components/ActionTimer";
import { OpponentTimer } from "@/components/OpponentTimer";
import { ShowdownTimeoutPanel } from "@/components/ShowdownTimeoutPanel";
import { AuthorityTimeoutPanel } from "@/components/AuthorityTimeoutPanel";
import { TransactionToast, useTransactionToasts } from "@/components/TransactionToast";
import { GameHistory, useGameHistory } from "@/components/GameHistory";
import { NETWORK } from "@/contexts/WalletProvider";
import { solToLamports, lamportsToSol } from "@/lib/utils";
import { evaluateHand, getHandDescription } from "@/lib/handEval";
import { useSounds, soundManager } from "@/lib/sounds";
import { SoundToggle } from "@/components/SoundToggle";
import { useHandHistory } from "@/hooks/useHandHistory";
import { OnChainHandHistory } from "@/components/OnChainHandHistory";
import { Tooltip, InfoIcon } from "@/components/Tooltip";
import { useChipAnimations } from "@/components/ChipAnimation";
import {
  ACTION_TIMEOUT_SECONDS,
  DEAL_TIMEOUT_SECONDS,
  ALLOWANCE_TIMEOUT_SECONDS,
  REVEAL_TIMEOUT_SECONDS,
  TABLE_INACTIVE_TIMEOUT_SECONDS,
} from "@/lib/constants";

export default function Home() {
  const { connected, publicKey, disconnect } = useWallet();
  const {
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
    setTableId,
    // MagicBlock VRF
    requestShuffle,
    setUseVrf,
    // Inco FHE Encryption
    encryptHoleCards,
    grantCardAllowance,
    encryptAndGrantCards,
    encryptAllPlayersCards,
    grantAllPlayersAllowances,
    decryptMyCards,
    revealCards,
    setUseIncoPrivacy,
    // Game Liveness (prevent stuck games)
    grantOwnAllowance,
    timeoutReveal,
    closeInactiveTable,
    // Program for event listeners
    program,
  } = usePokerGame();

  // On-chain hand history from events
  const { history: onChainHistory, isListening: isHistoryListening } = useHandHistory(program);

  // Expose hook functions to window for console testing (development only)
  useEffect(() => {
    if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pokerGame = (window as any).__pokerGame || {};
      // Only update functions, not gameState (to avoid constant updates)
      pokerGame.encryptHoleCards = encryptHoleCards;
      pokerGame.grantCardAllowance = grantCardAllowance;
      pokerGame.encryptAndGrantCards = encryptAndGrantCards;
      pokerGame.encryptAllPlayersCards = encryptAllPlayersCards;
      pokerGame.grantAllPlayersAllowances = grantAllPlayersAllowances;
      pokerGame.decryptMyCards = decryptMyCards;
      pokerGame.revealCards = revealCards;
      pokerGame.grantOwnAllowance = grantOwnAllowance;
      pokerGame.timeoutReveal = timeoutReveal;
      pokerGame.closeInactiveTable = closeInactiveTable;
      // Getter for fresh gameState (avoids stale closure)
      pokerGame.getGameState = () => gameState;
      (window as any).__pokerGame = pokerGame;
    }
    // Cleanup on unmount
    return () => {
      if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (window as any).__pokerGame;
      }
    };
  }, [encryptHoleCards, grantCardAllowance, encryptAndGrantCards, encryptAllPlayersCards, grantAllPlayersAllowances, decryptMyCards, revealCards, grantOwnAllowance, timeoutReveal, closeInactiveTable]);

  // Transaction toast notifications
  const {
    transactions,
    addTransaction,
    updateTransaction,
    dismissTransaction,
  } = useTransactionToasts();

  // Game history/action log
  const { events: gameEvents, addEvent: addGameEvent, clearHistory } = useGameHistory();

  // Sound effects
  const { playSound, initSounds } = useSounds();

  // Initialize sounds on first user interaction
  useEffect(() => {
    const handleFirstInteraction = () => {
      initSounds();
      document.removeEventListener('click', handleFirstInteraction);
    };
    document.addEventListener('click', handleFirstInteraction);
    return () => document.removeEventListener('click', handleFirstInteraction);
  }, [initSounds]);

  // Wrapper to execute actions with toast notifications
  const withToast = async (
    action: () => Promise<string>,
    pendingMessage: string,
    successMessage: string
  ) => {
    // Add pending toast immediately so user sees something is happening
    const toastId = addTransaction("pending", pendingMessage);
    try {
      const tx = await action();
      // Update with actual transaction signature and mark as confirmed
      updateTransaction(toastId, "confirmed", tx);
      return tx;
    } catch (e) {
      // Update toast to show error
      const errorMessage = e instanceof Error ? e.message : "Transaction failed";
      updateTransaction(toastId, "error", undefined, errorMessage);
      throw e;
    }
  };

  // UI state
  const [tableIdInput, setTableIdInput] = useState("demo-table");
  const [buyInSol, setBuyInSol] = useState(1);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createConfig, setCreateConfig] = useState({
    smallBlind: 0.01,
    bigBlind: 0.02,
    minBuyIn: 0.5,
    maxBuyIn: 5,
    maxPlayers: 6,
  });

  // Win celebration state
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationWinAmount, setCelebrationWinAmount] = useState<number | undefined>(undefined);

  // Auto-dismiss win celebration after 2 seconds
  useEffect(() => {
    if (showCelebration) {
      const timeout = setTimeout(() => {
        setShowCelebration(false);
        setCelebrationWinAmount(undefined);
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [showCelebration]);

  // Chip animation state
  const { betTrigger, winTrigger, triggerBetAnimation, triggerWinAnimation } = useChipAnimations();
  const prevBetsRef = useRef<Map<number, number>>(new Map());

  // Auto-load table on input
  useEffect(() => {
    if (tableIdInput) {
      setTableId(tableIdInput);
    }
  }, [tableIdInput, setTableId]);

  // Auto-set buy-in to table minimum when table loads
  useEffect(() => {
    if (gameState.table) {
      const minBuyIn = lamportsToSol(gameState.table.minBuyIn.toNumber());
      // Set to min buy-in if current value is below minimum
      if (buyInSol < minBuyIn) {
        setBuyInSol(minBuyIn);
      }
    }
  }, [gameState.table, buyInSol]);

  // Track phase changes, community cards, and winners for game history
  const prevPhaseRef = useRef(gameState.phase);
  const prevCommunityRef = useRef<number[]>([]);
  const isFirstRenderRef = useRef(true);
  // Track chips before showdown to detect winners
  const chipsBeforeShowdownRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    // Skip logging on first render (initial state)
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      prevPhaseRef.current = gameState.phase;
      return;
    }

    // Track phase changes
    if (prevPhaseRef.current !== gameState.phase) {
      // Play sounds for phase transitions
      switch (gameState.phase) {
        case "PreFlop":
          playSound("cardDeal");
          break;
        case "Flop":
        case "Turn":
        case "River":
          playSound("cardFlip");
          break;
      }

      // Phase messages - Flop/Turn/River handled by card events, no duplicate messages
      const phaseMessages: Record<string, string | null> = {
        "Dealing": "New hand starting...",
        "PreFlop": "Pre-flop betting",
        "Flop": null,  // Card event will show "Flop: X♥ Y♣ Z♠"
        "Turn": null,  // Card event will show "Turn: X♥"
        "River": null, // Card event will show "River: X♥"
        "Showdown": "Showdown!",
        "Settled": "Hand complete",
      };
      const message = phaseMessages[gameState.phase];

      // When entering Showdown, capture current chip counts
      if (gameState.phase === "Showdown") {
        const chipMap = new Map<number, number>();
        gameState.players.forEach((p) => {
          if (p.status !== "empty") {
            chipMap.set(p.seatIndex, p.chips);
          }
        });
        chipsBeforeShowdownRef.current = chipMap;
      }

      // When settling, detect winners by comparing chips
      if (gameState.phase === "Settled" && chipsBeforeShowdownRef.current.size > 0) {
        const winners: { seatIndex: number; winnings: number; handDesc?: string }[] = [];

        // Get community cards for hand evaluation
        const community = gameState.communityCards
          .map(c => Number(c))
          .filter(c => !isNaN(c) && c !== 255);

        gameState.players.forEach((p) => {
          if (p.status !== "empty") {
            const chipsBefore = chipsBeforeShowdownRef.current.get(p.seatIndex) ?? 0;
            const chipsNow = p.chips;
            if (chipsNow > chipsBefore) {
              // Try to evaluate hand if we have hole cards (only for current player)
              let handDesc: string | undefined;
              if (p.holeCards[0] !== null && p.holeCards[1] !== null && community.length === 5) {
                const allCards = [p.holeCards[0], p.holeCards[1], ...community];
                const evaluated = evaluateHand(allCards);
                handDesc = getHandDescription(evaluated);
              }

              winners.push({
                seatIndex: p.seatIndex,
                winnings: chipsNow - chipsBefore,
                handDesc,
              });
            }
          }
        });

        // Add winner events and trigger chip animations
        winners.forEach((winner, index) => {
          const winningsInSol = lamportsToSol(winner.winnings);
          const handInfo = winner.handDesc ? ` with ${winner.handDesc}` : "";
          addGameEvent("winner", `Seat ${winner.seatIndex + 1} won ${winningsInSol.toFixed(2)} SOL${handInfo}`, {
            seatIndex: winner.seatIndex,
            amount: winner.winnings,
          });
          // Trigger chip animation from pot to winner (stagger if multiple winners)
          setTimeout(() => {
            triggerWinAnimation(winner.seatIndex);
          }, index * 200);
        });

        // Play win sound and show celebration if current player won
        const currentPlayerSeat = gameState.players.find(p => p.player === publicKey?.toString());
        if (currentPlayerSeat) {
          const playerWin = winners.find(w => w.seatIndex === currentPlayerSeat.seatIndex);
          if (playerWin) {
            playSound("chipWin");
            setCelebrationWinAmount(playerWin.winnings);
            setShowCelebration(true);
          }
        }

        // Clear the chip tracking for next hand
        chipsBeforeShowdownRef.current = new Map();
      }

      // Only add phase event if there's a message (Flop/Turn/River handled by card events)
      if (message) {
        addGameEvent("phase", message);
      }

      // Add separator when new hand starts (don't clear history)
      if (gameState.phase === "Dealing") {
        addGameEvent("system", "━━━━━━ New Hand ━━━━━━");
      }

      prevPhaseRef.current = gameState.phase;
    }

    // Track community card reveals
    // Ensure cards are plain numbers (not BN, buffer values, etc.)
    const currentCommunity = gameState.communityCards
      .map(c => Number(c))
      .filter(c => !isNaN(c) && c !== 255);
    if (currentCommunity.length > prevCommunityRef.current.length) {
      const newCards = currentCommunity.slice(prevCommunityRef.current.length);
      if (newCards.length === 3) {
        addGameEvent("cards", "Flop:", { cards: newCards });
      } else if (newCards.length === 1 && currentCommunity.length === 4) {
        addGameEvent("cards", "Turn:", { cards: newCards });
      } else if (newCards.length === 1 && currentCommunity.length === 5) {
        addGameEvent("cards", "River:", { cards: newCards });
      }
      prevCommunityRef.current = [...currentCommunity];
    }
  }, [gameState.phase, gameState.communityCards, gameState.players, addGameEvent, playSound, publicKey, triggerWinAnimation]);

  // Track bets to trigger chip animations
  useEffect(() => {
    // Skip if no betting is happening
    if (gameState.phase === "Dealing" || gameState.phase === "Settled" || gameState.phase === "Showdown") {
      // Reset bet tracking when hand ends or starts
      if (gameState.phase === "Dealing" || gameState.phase === "Settled") {
        prevBetsRef.current = new Map();
      }
      return;
    }

    // Check each player for bet increases
    gameState.players.forEach((player) => {
      if (player.status === "empty" || player.status === "folded") return;

      const prevBet = prevBetsRef.current.get(player.seatIndex) ?? 0;
      const currentBet = player.currentBet;

      // Trigger animation if bet increased
      if (currentBet > prevBet) {
        const betIncrease = currentBet - prevBet;
        triggerBetAnimation(player.seatIndex, betIncrease);
      }
    });

    // Update previous bets
    const newBets = new Map<number, number>();
    gameState.players.forEach((player) => {
      if (player.status !== "empty") {
        newBets.set(player.seatIndex, player.currentBet);
      }
    });
    prevBetsRef.current = newBets;
  }, [gameState.players, gameState.phase, triggerBetAnimation]);

  // Find current player info
  const currentPlayer = gameState.players.find(
    (p) => p.player === publicKey?.toString()
  );

  // Check if all remaining players are all-in (no more betting possible)
  const activePlayers = gameState.players.filter(
    (p) => p.status === "playing" || p.status === "allin"
  );
  const playersWhoCanBet = activePlayers.filter((p) => p.status === "playing");
  const allPlayersAllIn = activePlayers.length >= 2 && playersWhoCanBet.length === 0;
  const onlyOneCanBet = playersWhoCanBet.length === 1;

  // Player can only act if:
  // - It's their turn
  // - They're not all-in
  // - Game is in betting phase
  // - Not waiting for community cards to be revealed
  const isPlayerTurn =
    currentPlayer &&
    currentPlayer.status === "playing" && // Not all-in or folded
    gameState.currentPlayerSeat !== null &&
    gameState.actionOn === currentPlayer.seatIndex &&
    gameState.phase !== "Dealing" &&
    gameState.phase !== "Showdown" &&
    gameState.phase !== "Settled" &&
    !allPlayersAllIn &&
    !gameState.awaitingCommunityReveal; // Block actions while revealing community cards

  // Calculate action panel values (never negative)
  const toCall = Math.max(0, gameState.currentBet - (currentPlayer?.currentBet ?? 0));
  const canCheck = toCall <= 0;

  // Check if we're in a betting phase (for showing timers)
  const isBettingPhase = ["PreFlop", "Flop", "Turn", "River"].includes(gameState.phase);

  // Play sound when it becomes player's turn
  const wasPlayerTurnRef = useRef(false);
  useEffect(() => {
    if (isPlayerTurn && !wasPlayerTurnRef.current) {
      playSound("yourTurn");
    }
    wasPlayerTurnRef.current = isPlayerTurn ?? false;
  }, [isPlayerTurn, playSound]);

  // Handle player action
  const handleAction = async (action: string, amount?: number) => {
    let actionType: ActionType;
    let actionLabel: string;
    switch (action) {
      case "fold":
        actionType = { type: "fold" };
        actionLabel = "Fold";
        break;
      case "check":
        actionType = { type: "check" };
        actionLabel = "Check";
        break;
      case "call":
        actionType = { type: "call" };
        actionLabel = toCall > 0 ? `Call ${lamportsToSol(toCall).toFixed(2)} SOL` : "Call";
        break;
      case "raise":
        actionType = { type: "raise", amount: amount ?? 0 };
        actionLabel = `Raise to ${lamportsToSol(amount ?? 0).toFixed(2)} SOL`;
        break;
      case "allin":
        actionType = { type: "allIn" };
        actionLabel = "All-In";
        break;
      default:
        return;
    }

    // Play sound for the action
    switch (action) {
      case "fold": playSound("fold"); break;
      case "check": playSound("check"); break;
      case "call": playSound("chipBet"); break;
      case "raise": playSound("chipBet"); break;
      case "allin": playSound("allIn"); break;
    }

    try {
      await withToast(
        () => playerAction(actionType),
        `Submitting ${actionLabel}...`,
        `${actionLabel} confirmed`
      );
      // Log the action to game history (use 1-indexed seats for display)
      const seatLabel = currentPlayer ? `Seat ${currentPlayer.seatIndex + 1}` : "Player";
      addGameEvent("action", `${seatLabel}: ${actionLabel}`, {
        seatIndex: currentPlayer?.seatIndex,
        amount: amount,
      });
    } catch (e) {
      console.error("Action failed:", e);
    }
  };

  // Handle create table
  const handleCreateTable = async () => {
    try {
      await withToast(
        () => createTable({
          tableId: tableIdInput,
          smallBlind: solToLamports(createConfig.smallBlind),
          bigBlind: solToLamports(createConfig.bigBlind),
          minBuyIn: solToLamports(createConfig.minBuyIn),
          maxBuyIn: solToLamports(createConfig.maxBuyIn),
          maxPlayers: createConfig.maxPlayers,
        }),
        "Creating table...",
        "Table created"
      );
      setShowCreateModal(false);
    } catch (e) {
      // Handle "table already exists" gracefully - table was loaded, not an error
      if (e instanceof Error && e.message.includes("already exists")) {
        setShowCreateModal(false);
        // The table is now loaded in state, no need to show error
      } else {
        console.error("Create failed:", e);
      }
    }
  };

  // Handle join table
  const handleJoinTable = async () => {
    if (selectedSeat === null) return;
    try {
      await withToast(
        () => joinTable(selectedSeat, solToLamports(buyInSol)),
        `Joining table with ${buyInSol} SOL...`,
        "Joined table"
      );
      setSelectedSeat(null);
    } catch (e) {
      console.error("Join failed:", e);
    }
  };

  // Map game state players to component format
  // Map game state players to component format (memoized to avoid recalculating every render)
  // Use decrypted cards for current player if available
  // Also include revealed cards for showdown display
  const playersForTable = useMemo(() => {
    return gameState.players.map((p) => {
      const isCurrentPlayer = p.player === publicKey?.toString();
      // If this is the current player and we have decrypted cards, use those
      const holeCards: [number | null, number | null] =
        isCurrentPlayer && gameState.decryptedCards[0] !== null
          ? gameState.decryptedCards
          : p.holeCards;

      return {
        seatIndex: p.seatIndex,
        player: p.player,
        chips: p.chips,
        currentBet: p.currentBet,
        holeCards,
        status: p.status,
        isEncrypted: p.isEncrypted && gameState.decryptedCards[0] === null, // Still encrypted if not decrypted (use === null, not !value, since card 0 is valid)
        // Include revealed cards for showdown display
        revealedCards: p.revealedCards,
        cardsRevealed: p.cardsRevealed,
      };
    });
  }, [gameState.players, gameState.decryptedCards, publicKey]);

  // Determine if we're in showdown display mode (Showdown or Settled with revealed cards)
  const isShowdownPhase = gameState.phase === "Showdown" || gameState.phase === "Settled";

  // Check if all active players have revealed their cards for showdown
  // Active players are those with status "playing" or "allin" (not folded)
  const allPlayersRevealed = useMemo(() => {
    const activePlayers = gameState.players.filter(
      p => p.status === "playing" || p.status === "allin"
    );
    // If no active players, allow showdown (edge case)
    if (activePlayers.length === 0) return true;
    // If only one player remains (everyone else folded), no reveal needed - they win automatically
    if (activePlayers.length === 1) return true;
    // Check if all active players have revealed their cards
    return activePlayers.every(p => p.cardsRevealed);
  }, [gameState.players]);

  // Count how many players still need to reveal
  const playersNeedingReveal = useMemo(() => {
    return gameState.players.filter(
      p => (p.status === "playing" || p.status === "allin") && !p.cardsRevealed
    ).length;
  }, [gameState.players]);

  return (
    <main className="min-h-screen relative">
      {/* Header */}
      <header className="glass-dark sticky top-0 z-50 px-6 py-4 flex justify-between items-center border-b border-white/5">
        <div className="flex items-center gap-4">
          <h1 className="font-display text-2xl font-bold tracking-wide">
            <span className="text-[var(--text-primary)]">Hidden</span>
            <span className="text-gold-gradient">Hand</span>
          </h1>
          <span
            className={`
              text-[10px] px-2.5 py-1 rounded-full uppercase tracking-wider font-semibold
              ${NETWORK === "localnet"
                ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                : "bg-[var(--gold-main)]/20 text-[var(--gold-light)] border border-[var(--gold-main)]/30"
              }
            `}
          >
            {NETWORK}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <SoundToggle />
          <WalletButton className="btn-gold !text-sm !px-5 !py-2.5 !rounded-xl" />
        </div>
      </header>

      {/* Main content */}
      <div className="container mx-auto px-4 py-8 pb-32">
        {!connected ? (
          /* Landing Page */
          <div className="relative flex flex-col items-center justify-center py-8 overflow-hidden">
            {/* Floating Cards Background */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              {/* Card 1 - Top Left */}
              <div
                className="floating-card animate-float-card"
                style={{
                  top: '10%',
                  left: '8%',
                  '--rotate-start': '-15deg',
                  '--rotate-end': '-12deg',
                  animationDelay: '0s',
                } as React.CSSProperties}
              />
              {/* Card 2 - Top Right */}
              <div
                className="floating-card hearts animate-float-card"
                style={{
                  top: '15%',
                  right: '12%',
                  '--rotate-start': '20deg',
                  '--rotate-end': '25deg',
                  animationDelay: '1s',
                } as React.CSSProperties}
              />
              {/* Card 3 - Bottom Left */}
              <div
                className="floating-card diamonds animate-float-card"
                style={{
                  bottom: '20%',
                  left: '5%',
                  '--rotate-start': '-8deg',
                  '--rotate-end': '-5deg',
                  animationDelay: '2s',
                } as React.CSSProperties}
              />
              {/* Card 4 - Bottom Right */}
              <div
                className="floating-card clubs animate-float-card"
                style={{
                  bottom: '25%',
                  right: '8%',
                  '--rotate-start': '12deg',
                  '--rotate-end': '18deg',
                  animationDelay: '0.5s',
                } as React.CSSProperties}
              />
              {/* Card 5 - Mid Left */}
              <div
                className="floating-card animate-float-card"
                style={{
                  top: '45%',
                  left: '3%',
                  '--rotate-start': '25deg',
                  '--rotate-end': '30deg',
                  animationDelay: '1.5s',
                  opacity: 0.4,
                } as React.CSSProperties}
              />
              {/* Card 6 - Mid Right */}
              <div
                className="floating-card hearts animate-float-card"
                style={{
                  top: '50%',
                  right: '3%',
                  '--rotate-start': '-20deg',
                  '--rotate-end': '-15deg',
                  animationDelay: '2.5s',
                  opacity: 0.4,
                } as React.CSSProperties}
              />
            </div>

            {/* Hero */}
            <div className="relative z-10 max-w-3xl mx-auto mb-10 text-center">
              <div className="animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
                <p className="text-[var(--gold-main)] font-medium tracking-[0.3em] uppercase text-sm mb-4">
                  Solana Privacy Poker
                </p>
              </div>

              <h2
                className="font-display text-5xl md:text-6xl font-bold text-[var(--text-primary)] mb-5 leading-[1.1] animate-fade-in-up"
                style={{ animationDelay: '0.2s', opacity: 0, animationFillMode: 'forwards' }}
              >
                Don&apos;t Trust
                <br />
                <span className="text-gold-gradient animate-glow-pulse inline-block">
                  the Dealer
                </span>
              </h2>

              <p
                className="text-xl md:text-2xl text-[var(--text-secondary)] mb-8 leading-relaxed animate-fade-in-up max-w-xl mx-auto"
                style={{ animationDelay: '0.4s', opacity: 0, animationFillMode: 'forwards' }}
              >
                The only poker game where the house can&apos;t see your cards.
                <span className="block mt-1 text-[var(--text-muted)] text-base">
                  Encrypted. On-chain. Provably fair.
                </span>
              </p>

              <div
                className="animate-fade-in-up"
                style={{ animationDelay: '0.6s', opacity: 0, animationFillMode: 'forwards' }}
              >
                <WalletButton className="btn-gold !text-base !px-10 !py-3 !rounded-xl !font-bold" />
              </div>
            </div>

            {/* Features */}
            <div
              className="relative z-10 grid md:grid-cols-3 gap-4 max-w-4xl mx-auto w-full animate-fade-in-up"
              style={{ animationDelay: '0.8s', opacity: 0, animationFillMode: 'forwards' }}
            >
              {[
                {
                  icon: (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  ),
                  title: "FHE Encryption",
                  desc: "Hole cards encrypted with Inco Lightning. Only you can decrypt them.",
                },
                {
                  icon: (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  ),
                  title: "Verified Fair",
                  desc: "MagicBlock VRF ensures provably random shuffles. No rigged decks.",
                },
                {
                  icon: (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  ),
                  title: "On Solana",
                  desc: "Sub-second transactions. Every bet, fold, and showdown on-chain.",
                },
              ].map((feature, idx) => (
                <div
                  key={idx}
                  className="glass p-5 rounded-2xl hover:border-[var(--gold-main)]/40 transition-all duration-300 group hover:-translate-y-1"
                >
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[var(--felt-main)] to-[var(--felt-dark)] flex items-center justify-center text-[var(--gold-main)] mb-3 group-hover:scale-110 transition-transform duration-300 shadow-lg">
                    {feature.icon}
                  </div>
                  <h3 className="font-display text-sm font-bold text-[var(--text-primary)] mb-1.5 tracking-wide">
                    {feature.title}
                  </h3>
                  <p className="text-[var(--text-secondary)] text-xs leading-relaxed">
                    {feature.desc}
                  </p>
                </div>
              ))}
            </div>

            {/* Subtle gradient overlay at bottom */}
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[var(--bg-deep)] to-transparent pointer-events-none" />
          </div>
        ) : (
          /* Game Interface */
          <div className="space-y-6">
            {/* Table Controls */}
            <div className="glass rounded-2xl p-5">
              <div className="flex flex-wrap items-center gap-4">
                {/* Table ID input */}
                <div className="flex items-center gap-3">
                  <label className="text-[var(--text-muted)] text-sm uppercase tracking-wider">
                    Table
                  </label>
                  <input
                    type="text"
                    value={tableIdInput}
                    onChange={(e) => setTableIdInput(e.target.value)}
                    className="bg-[var(--bg-dark)] text-[var(--text-primary)] px-4 py-2.5 rounded-xl text-sm w-44 border border-white/5 focus:border-[var(--gold-main)] transition-colors"
                    placeholder="Table name"
                  />
                </div>

                {/* Create / Join buttons */}
                {!gameState.table ? (
                  <button
                    onClick={() => setShowCreateModal(true)}
                    disabled={loading || !tableIdInput}
                    className="btn-success px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                  >
                    Create Table
                  </button>
                ) : (
                  <>
                    {/* Table status */}
                    <div className="glass-dark px-4 py-2 rounded-xl text-sm flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            gameState.tableStatus === "Playing"
                              ? "bg-[var(--status-active)]"
                              : gameState.tableStatus === "Waiting"
                              ? "bg-[var(--status-warning)]"
                              : "bg-[var(--status-danger)]"
                          }`}
                        />
                        <span className="text-[var(--text-secondary)]">
                          {gameState.tableStatus}
                        </span>
                      </div>
                      <span className="text-[var(--text-muted)]">
                        {gameState.players.filter((p) => p.status !== "empty").length}/
                        {gameState.table.maxPlayers} players
                      </span>
                    </div>

                    {/* Table Info - Buy-in Range */}
                    <div className="glass-dark px-4 py-2 rounded-xl text-sm flex items-center gap-2">
                      <span className="text-[var(--text-muted)]">Buy-in:</span>
                      <span className="text-[var(--text-primary)] font-medium">
                        {lamportsToSol(gameState.table.minBuyIn.toNumber())} - {lamportsToSol(gameState.table.maxBuyIn.toNumber())} SOL
                      </span>
                    </div>

                    {/* Join if not at table */}
                    {!currentPlayer && gameState.tableStatus === "Waiting" && (
                      <div className="flex items-center gap-3 flex-wrap">
                        <select
                          value={selectedSeat ?? ""}
                          onChange={(e) =>
                            setSelectedSeat(
                              e.target.value ? Number(e.target.value) : null
                            )
                          }
                          className="bg-[var(--bg-dark)] text-[var(--text-primary)] px-4 py-2.5 rounded-xl text-sm border border-white/5"
                        >
                          <option value="">Select seat</option>
                          {gameState.players
                            .filter((p) => p.status === "empty")
                            .map((p) => (
                              <option key={p.seatIndex} value={p.seatIndex}>
                                Seat {p.seatIndex + 1}
                              </option>
                            ))}
                        </select>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={buyInSol}
                            onChange={(e) => setBuyInSol(Number(e.target.value))}
                            min={lamportsToSol(gameState.table.minBuyIn.toNumber())}
                            max={lamportsToSol(gameState.table.maxBuyIn.toNumber())}
                            step={0.1}
                            className="bg-[var(--bg-dark)] text-[var(--text-primary)] px-4 py-2.5 rounded-xl text-sm w-24 border border-white/5"
                          />
                          <span className="text-[var(--text-muted)] text-sm">SOL</span>
                        </div>
                        <button
                          onClick={handleJoinTable}
                          disabled={loading || selectedSeat === null || buyInSol < lamportsToSol(gameState.table.minBuyIn.toNumber()) || buyInSol > lamportsToSol(gameState.table.maxBuyIn.toNumber())}
                          className="btn-info px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                        >
                          Join
                        </button>
                        {/* Warning if buy-in out of range */}
                        {(buyInSol < lamportsToSol(gameState.table.minBuyIn.toNumber()) || buyInSol > lamportsToSol(gameState.table.maxBuyIn.toNumber())) && (
                          <span className="text-[var(--status-warning)] text-xs">
                            Buy-in must be {lamportsToSol(gameState.table.minBuyIn.toNumber())} - {lamportsToSol(gameState.table.maxBuyIn.toNumber())} SOL
                          </span>
                        )}
                      </div>
                    )}

                    {/* Leave table */}
                    {currentPlayer && (gameState.tableStatus === "Waiting" || currentPlayer.chips === 0) && (
                      <button
                        onClick={() => leaveTable()}
                        disabled={loading}
                        className="btn-danger px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                      >
                        Leave Table
                      </button>
                    )}

                    {/* Close inactive table - shows after 1 hour of inactivity */}
                    {gameState.tableStatus === "Waiting" &&
                     gameState.lastReadyTime &&
                     (Date.now() / 1000 - gameState.lastReadyTime) >= TABLE_INACTIVE_TIMEOUT_SECONDS && (
                      <button
                        onClick={async () => {
                          if (confirm("Are you sure you want to close this table? All funds will be returned to players.")) {
                            try {
                              await closeInactiveTable();
                              addGameEvent("system", "Inactive table closed, funds returned to all players");
                            } catch (e) {
                              console.error("Failed to close table:", e);
                            }
                          }
                        }}
                        disabled={loading}
                        className="btn-warning px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        Close Inactive Table
                      </button>
                    )}


                    {/* Rebuy message */}
                    {currentPlayer && currentPlayer.chips === 0 && (
                      <div className="glass-dark border border-[var(--status-warning)]/30 rounded-xl px-4 py-2 flex items-center gap-2">
                        <svg className="w-4 h-4 text-[var(--status-warning)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span className="text-[var(--status-warning)] text-sm">No chips!</span>
                        <span className="text-[var(--text-muted)] text-sm">Leave and rejoin to rebuy.</span>
                      </div>
                    )}
                  </>
                )}

                {/* Error display */}
                {error && (
                  <div className="ml-auto glass-dark border border-[var(--status-danger)]/30 rounded-xl px-4 py-2 flex items-center gap-3">
                    <span className="text-[var(--status-danger)] text-sm">
                      {error.startsWith("WALLET_DISCONNECTED:")
                        ? error.replace("WALLET_DISCONNECTED:", "")
                        : error}
                    </span>
                    {error.startsWith("WALLET_DISCONNECTED:") && (
                      <button
                        onClick={() => disconnect()}
                        className="px-3 py-1 text-xs font-semibold rounded-lg bg-[var(--status-danger)]/20 text-[var(--status-danger)] hover:bg-[var(--status-danger)]/30 transition-colors"
                      >
                        Disconnect
                      </button>
                    )}
                  </div>
                )}

                {/* Loading indicator */}
                {loading && (
                  <div className="ml-auto flex items-center gap-2 text-[var(--text-muted)] text-sm">
                    <div className="animate-spin h-4 w-4 border-2 border-[var(--gold-main)]/30 border-t-[var(--gold-main)] rounded-full" />
                    Processing...
                  </div>
                )}
              </div>
            </div>

            {/* Authority Controls */}
            {gameState.isAuthority && gameState.table && (
              <div className="glass border border-[var(--gold-main)]/20 rounded-2xl p-5">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[var(--gold-main)]" />
                    <span className="text-[var(--gold-main)] text-sm font-medium uppercase tracking-wider">
                      Authority Controls
                    </span>
                  </div>

                  {/* VRF Toggle */}
                  <div className="flex items-center gap-2 glass-dark px-3 py-1.5 rounded-lg">
                    <span className="text-[var(--text-muted)] text-xs uppercase tracking-wider">VRF</span>
                    <button
                      onClick={() => setUseVrf(!gameState.useVrf)}
                      className={`relative w-10 h-5 rounded-full transition-colors ${
                        gameState.useVrf ? "bg-purple-500" : "bg-gray-600"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                          gameState.useVrf ? "translate-x-5" : ""
                        }`}
                      />
                    </button>
                    {gameState.useVrf && (
                      <span className="text-purple-400 text-xs font-medium">Provably Fair</span>
                    )}
                  </div>

                  {/* Inco FHE Privacy Toggle (Cryptographic) */}
                  <div className="flex items-center gap-2 glass-dark px-3 py-1.5 rounded-lg">
                    <span className="text-[var(--text-muted)] text-xs uppercase tracking-wider">Inco</span>
                    <button
                      onClick={() => setUseIncoPrivacy(!gameState.useIncoPrivacy)}
                      className={`relative w-10 h-5 rounded-full transition-colors ${
                        gameState.useIncoPrivacy ? "bg-cyan-500" : "bg-gray-600"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                          gameState.useIncoPrivacy ? "translate-x-5" : ""
                        }`}
                      />
                    </button>
                    {gameState.useIncoPrivacy && (
                      <span className="text-cyan-400 text-xs font-medium">FHE Encrypted</span>
                    )}
                  </div>

                  {/* Count players with chips */}
                  {(() => {
                    const playersWithChips = gameState.players.filter(
                      (p) => p.status !== "empty" && p.chips > 0
                    ).length;
                    const totalPlayers = gameState.players.filter(
                      (p) => p.status !== "empty"
                    ).length;
                    const canStart = playersWithChips >= 2;

                    return (
                      <>
                        {/* Start Hand */}
                        {gameState.tableStatus === "Waiting" && totalPlayers >= 2 && (
                          canStart ? (
                            <button
                              onClick={() => withToast(
                                () => startHand(),
                                "Starting hand...",
                                "Hand started"
                              )}
                              disabled={loading}
                              className="btn-gold px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                            >
                              Start Hand
                            </button>
                          ) : (
                            <span className="text-[var(--status-warning)] text-sm">
                              Need 2+ players with chips ({playersWithChips}/{totalPlayers} have chips)
                            </span>
                          )
                        )}

                        {/* Deal Cards - VRF Flow (Streamlined: Shuffle + Encrypt + Grant in one click) */}
                        {gameState.phase === "Dealing" && gameState.useVrf && (
                          canStart ? (
                            <>
                              {/* Deal Cards - Single button that does everything */}
                              {!gameState.isDeckShuffled && !gameState.isShuffling && (
                                <Tooltip
                                  title="🎲 Deal Cards"
                                  content="Shuffles deck with MagicBlock VRF (provably fair), encrypts cards with Inco FHE (cryptographic privacy), and grants decryption access to all players. One click does it all!"
                                >
                                  <button
                                    onClick={() => {
                                      playSound("shuffle");
                                      withToast(
                                        () => requestShuffle(),
                                        "Dealing cards...",
                                        "Cards dealt - ready to play!"
                                      );
                                    }}
                                    disabled={loading}
                                    className="btn-gold px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    Deal Cards
                                    <InfoIcon />
                                  </button>
                                </Tooltip>
                              )}
                              {/* Dealing in progress - shows current step */}
                              {gameState.isShuffling && (
                                <div className="flex items-center gap-2 text-purple-400 text-sm">
                                  <div className="animate-spin h-4 w-4 border-2 border-purple-400/30 border-t-purple-400 rounded-full" />
                                  {!gameState.areCardsEncrypted ? "Shuffling & encrypting..." : "Granting allowances..."}
                                </div>
                              )}
                              {/* Cards ready - game can begin */}
                              {gameState.isDeckShuffled && gameState.allPlayersHaveAllowances && (
                                <div className="flex items-center gap-2 text-green-400 text-sm">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  Cards dealt - click Decrypt to see your hand
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="text-[var(--status-warning)] text-sm">
                              Cannot deal - need 2+ players with chips
                            </span>
                          )
                        )}

                        {/* Deal Cards - Standard (non-VRF) */}
                        {gameState.phase === "Dealing" && !gameState.useVrf && (
                          canStart ? (
                            <button
                              onClick={() => {
                                playSound("shuffle");
                                withToast(
                                  () => dealCards(),
                                  "Dealing cards...",
                                  "Cards dealt"
                                );
                              }}
                              disabled={loading}
                              className="btn-gold px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                            >
                              Deal Cards
                            </button>
                          ) : (
                            <span className="text-[var(--status-warning)] text-sm">
                              Cannot deal - need 2+ players with chips
                            </span>
                          )
                        )}

                        {/* Inco FHE Encryption - show after cards are dealt */}
                        {gameState.phase === "PreFlop" && gameState.useIncoPrivacy && !gameState.areCardsEncrypted && !gameState.isEncrypting && (
                          <button
                            onClick={async () => {
                              try {
                                await encryptAllPlayersCards();
                                addGameEvent("privacy", "Cards encrypted with Inco FHE");
                              } catch (e) {
                                console.error("Encryption failed:", e);
                              }
                            }}
                            disabled={loading}
                            className="btn-info px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                            Encrypt Cards (Inco)
                          </button>
                        )}
                        {/* Encryption in progress */}
                        {gameState.isEncrypting && (
                          <div className="text-cyan-400 text-sm flex items-center gap-2">
                            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            Encrypting cards...
                          </div>
                        )}
                        {/* Cards encrypted indicator */}
                        {gameState.areCardsEncrypted && (
                          <div className="flex items-center gap-2 glass-dark px-3 py-1.5 rounded-lg border border-cyan-500/30">
                            <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                            <span className="text-cyan-400 text-xs font-medium">FHE Encrypted</span>
                          </div>
                        )}
                        {/* Grant Allowances - now auto-granted after VRF shuffle completes */}
                        {/* This indicator shows while auto-grant is in progress */}
                        {gameState.isAuthority && gameState.areCardsEncrypted && !gameState.allPlayersHaveAllowances && gameState.isShuffling && (
                          <div className="flex items-center gap-2 glass-dark px-3 py-1.5 rounded-lg border border-blue-500/30">
                            <svg className="animate-spin w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span className="text-blue-400 text-xs font-medium">Granting allowances...</span>
                          </div>
                        )}
                        {/* Self-grant allowance button - for non-authority after timeout */}
                        {gameState.areCardsEncrypted && !gameState.areAllowancesGranted && !gameState.isAuthority && !gameState.isEncrypting &&
                         gameState.lastActionTime && (Date.now() / 1000 - gameState.lastActionTime) >= ALLOWANCE_TIMEOUT_SECONDS && (
                          <button
                            onClick={async () => {
                              try {
                                await grantOwnAllowance();
                                addGameEvent("privacy", "Self-granted decryption allowance after timeout");
                              } catch (e) {
                                console.error("Failed to self-grant allowance:", e);
                              }
                            }}
                            disabled={loading}
                            className="btn-warning px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Grant My Allowance (Timeout)
                          </button>
                        )}
                        {/* Allowances granted indicator - shows when ALL players have allowances */}
                        {gameState.areCardsEncrypted && gameState.allPlayersHaveAllowances && (
                          <div className="flex items-center gap-2 glass-dark px-3 py-1.5 rounded-lg border border-green-500/30">
                            <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span className="text-green-400 text-xs font-medium">Ready to Decrypt</span>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {/* Showdown */}
                  {(gameState.phase === "Showdown" ||
                    (gameState.phase === "Settled" && gameState.pot > 0)) && (
                    <>
                      {allPlayersRevealed ? (
                        <button
                          onClick={() => showdown()}
                          disabled={loading}
                          className="btn-gold px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                        >
                          {gameState.phase === "Showdown" ? "Run Showdown" : "Award Pot"}
                        </button>
                      ) : (
                        <div className="glass-dark px-4 py-2.5 rounded-xl text-center">
                          <p className="text-yellow-400 text-sm font-medium">
                            Waiting for {playersNeedingReveal} player{playersNeedingReveal > 1 ? 's' : ''} to reveal cards
                          </p>
                          <p className="text-xs text-[var(--text-muted)] mt-1">
                            All players must reveal before showdown
                          </p>
                          {/* Timeout reveal option after reveal timeout */}
                          {gameState.lastActionTime && (Date.now() / 1000 - gameState.lastActionTime) >= REVEAL_TIMEOUT_SECONDS && (
                            <div className="mt-3 pt-3 border-t border-white/10">
                              <p className="text-orange-400 text-xs mb-2">
                                Reveal timeout reached - you can muck non-revealing players
                              </p>
                              <div className="flex flex-wrap gap-2 justify-center">
                                {activePlayers
                                  .filter(p => !p.cardsRevealed && p.status !== "folded")
                                  .map(p => (
                                    <button
                                      key={p.seatIndex}
                                      onClick={async () => {
                                        try {
                                          await timeoutReveal(p.seatIndex);
                                          addGameEvent("system", `Player at seat ${p.seatIndex + 1} mucked for not revealing`);
                                        } catch (e) {
                                          console.error("Failed to timeout player:", e);
                                        }
                                      }}
                                      disabled={loading}
                                      className="btn-danger px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
                                    >
                                      Muck Seat {p.seatIndex + 1}
                                    </button>
                                  ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* Phase indicator */}
                  {gameState.tableStatus === "Playing" && (
                    <span className="ml-auto text-[var(--text-muted)] text-sm">
                      Phase: <span className="text-[var(--text-primary)] font-medium">{gameState.phase}</span>
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Start Hand timeout panel for non-authority players */}
            {!gameState.isAuthority && currentPlayer && gameState.table &&
              gameState.tableStatus === "Waiting" &&
              gameState.players.filter((p) => p.status !== "empty" && p.chips > 0).length >= 2 && (
              <AuthorityTimeoutPanel
                lastTimestamp={gameState.lastReadyTime}
                delayBeforeShowing={DEAL_TIMEOUT_SECONDS}
                timeoutSeconds={ACTION_TIMEOUT_SECONDS}
                waitingMessage="Waiting for authority to start hand..."
                readyMessage="Timeout reached - you can start the hand"
                buttonLabel="Start Hand"
                onAction={() => withToast(() => startHand(), "Starting hand...", "Hand started")}
                isLoading={loading}
              />
            )}

            {/* Deal Cards timeout panel for non-authority players */}
            {!gameState.isAuthority && currentPlayer && gameState.table &&
              gameState.phase === "Dealing" && (
              <AuthorityTimeoutPanel
                lastTimestamp={gameState.lastActionTime}
                delayBeforeShowing={Math.floor(DEAL_TIMEOUT_SECONDS / 2)}
                timeoutSeconds={DEAL_TIMEOUT_SECONDS}
                waitingMessage="Waiting for authority to deal cards..."
                readyMessage="Timeout reached - you can deal the cards"
                buttonLabel="Deal Cards"
                onAction={async () => {
                  playSound("shuffle");
                  return withToast(() => dealCards(), "Dealing cards...", "Cards dealt");
                }}
                isLoading={loading}
              />
            )}

            {/* Showdown button for non-authority players (after timeout) */}
            {/* Only show when all players have revealed their cards */}
            {!gameState.isAuthority && currentPlayer && gameState.table &&
              allPlayersRevealed &&
              (gameState.phase === "Showdown" ||
                (gameState.phase === "Settled" && gameState.pot > 0)) && (
              <ShowdownTimeoutPanel
                lastActionTime={gameState.lastActionTime}
                phase={gameState.phase}
                onShowdown={showdown}
                isLoading={loading}
              />
            )}

            {/* Poker table */}
            {gameState.table && (
              <PokerTable
                tableId={gameState.tableId}
                phase={gameState.phase}
                pot={gameState.pot}
                communityCards={gameState.communityCards.length > 0 ? gameState.communityCards : [255, 255, 255, 255, 255]}
                currentBet={gameState.currentBet}
                dealerPosition={gameState.dealerPosition}
                actionOn={gameState.actionOn}
                players={playersForTable}
                currentPlayerAddress={publicKey?.toString() ?? ""}
                smallBlind={gameState.smallBlind}
                bigBlind={gameState.bigBlind}
                isShowdownPhase={isShowdownPhase}
                isVrfVerified={gameState.useVrf && gameState.isDeckShuffled}
                chipBetTrigger={betTrigger}
                chipWinTrigger={winTrigger}
                showWinCelebration={showCelebration}
                winAmount={celebrationWinAmount}
              />
            )}

            {/* Showdown Results Banner - shows after showdown when pot has been distributed */}
            {gameState.phase === "Settled" && gameState.pot === 0 && gameState.players.some(p => p.cardsRevealed) && (
              <div className="max-w-lg mx-auto glass border border-amber-500/30 rounded-2xl p-5 text-center mb-4">
                <div className="flex items-center justify-center gap-3 mb-2">
                  <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                  <span className="text-amber-300 font-bold text-lg">Showdown Complete</span>
                  <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                </div>
                <p className="text-[var(--text-secondary)] text-sm">
                  All players&apos; cards are now visible. Review the results above!
                </p>
                <p className="text-[var(--text-muted)] text-xs mt-2">
                  Cards will reset when a new hand is started
                </p>
              </div>
            )}

            {/* Decrypt My Cards button - shows when current player has encrypted cards AND allowances granted */}
            {/* Button appears for all players once authority grants allowances (detected on-chain) */}
            {/* FAIRNESS: Requires allPlayersHaveAllowances so no one can decrypt before others */}
            {/* Also check phase is not Dealing (cards must be dealt first) */}
            {currentPlayer && currentPlayer.isEncrypted && gameState.decryptedCards[0] === null &&
             gameState.areAllowancesGranted && gameState.allPlayersHaveAllowances &&
             gameState.tableStatus === "Playing" &&
             gameState.phase !== "Settled" && gameState.phase !== "Dealing" && (
              <div className="max-w-md mx-auto glass border border-cyan-500/30 rounded-2xl p-5 text-center">
                <div className="flex items-center justify-center gap-2 mb-3">
                  <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span className="text-cyan-400 font-semibold">
                    Your cards are encrypted
                  </span>
                </div>
                <p className="text-[var(--text-muted)] text-sm mb-4">
                  Click below to decrypt and view your hole cards
                </p>
                {gameState.isDecrypting ? (
                  <div className="text-cyan-400 text-sm flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Decrypting with Inco...
                  </div>
                ) : (
                  <Tooltip
                    title="🔐 Inco FHE Decryption"
                    content="Your cards are encrypted on-chain using Fully Homomorphic Encryption. Only you can decrypt them locally - no one else can see your hand."
                  >
                    <button
                      onClick={async () => {
                        try {
                          await decryptMyCards();
                          addGameEvent("privacy", "Cards decrypted via Inco FHE");
                        } catch (e) {
                          console.error("Decryption failed:", e);
                        }
                      }}
                      disabled={loading}
                      className="btn-info px-6 py-3 rounded-xl font-semibold disabled:opacity-50 flex items-center gap-2 mx-auto"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                      </svg>
                      Decrypt My Cards
                      <InfoIcon />
                    </button>
                  </Tooltip>
                )}
              </div>
            )}

            {/* Reveal Cards for Showdown */}
            {/* Only show when: in Showdown phase, player is active (not folded), and multiple players remain */}
            {currentPlayer &&
             gameState.phase === "Showdown" &&
             currentPlayer.status !== "folded" &&
             activePlayers.length > 1 &&
             gameState.decryptedCards[0] !== null &&
             gameState.decryptedCards[1] !== null &&
             !currentPlayer.cardsRevealed && (
              <div className="max-w-md mx-auto glass border border-amber-500/30 rounded-2xl p-5 text-center animate-glow-reveal">
                <div className="flex items-center justify-center gap-2 mb-3">
                  <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  <span className="text-amber-300 font-semibold">
                    Showdown - Reveal Your Cards
                  </span>
                </div>
                <p className="text-[var(--text-muted)] text-sm mb-4">
                  Submit your decrypted cards to the blockchain for hand evaluation
                </p>
                {gameState.isRevealing ? (
                  <div className="text-amber-400 text-sm flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Revealing cards on-chain...
                  </div>
                ) : (
                  <Tooltip
                    title="✅ Ed25519 Verified Reveal"
                    content="Cryptographic signature proves these are your real cards from Inco decryption. No one can fake their hand at showdown."
                  >
                    <button
                      onClick={async () => {
                        try {
                          await revealCards();
                          addGameEvent("cards", "Cards revealed for showdown");
                        } catch (e) {
                          console.error("Reveal failed:", e);
                        }
                      }}
                      disabled={loading}
                      className="bg-amber-600 hover:bg-amber-500 text-white px-6 py-3 rounded-xl font-semibold disabled:opacity-50 flex items-center gap-2 mx-auto transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      Reveal Cards
                      <InfoIcon />
                    </button>
                  </Tooltip>
                )}
              </div>
            )}

            {/* Cards Revealed Confirmation */}
            {/* Only show when: in Showdown phase, player is active (not folded), and multiple players remain */}
            {currentPlayer &&
             gameState.phase === "Showdown" &&
             currentPlayer.status !== "folded" &&
             activePlayers.length > 1 &&
             currentPlayer.cardsRevealed && (
              <div className="max-w-md mx-auto glass border border-green-500/30 rounded-2xl p-5 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-green-300 font-semibold">
                    Cards Revealed
                  </span>
                </div>
                <p className="text-[var(--text-muted)] text-sm">
                  Waiting for other players to reveal their cards...
                </p>
              </div>
            )}

            {/* All-in indicator */}
            {allPlayersAllIn && gameState.tableStatus === "Playing" &&
             gameState.phase !== "Showdown" && gameState.phase !== "Settled" && (
              <div className="max-w-md mx-auto glass border border-[var(--gold-main)]/30 rounded-2xl p-5 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-[var(--gold-main)] animate-pulse" />
                  <span className="text-[var(--gold-light)] font-semibold">
                    All players are all-in!
                  </span>
                </div>
                <p className="text-[var(--text-muted)] text-sm">
                  Cards running out automatically...
                </p>
              </div>
            )}

            {/* Revealing community cards indicator */}
            {gameState.awaitingCommunityReveal && gameState.tableStatus === "Playing" && (
              <div className="max-w-md mx-auto glass border border-purple-500/30 rounded-2xl p-5 text-center">
                <div className="flex items-center justify-center gap-3 mb-2">
                  <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-purple-300 font-semibold">
                    {gameState.phase === "PreFlop" ? "Revealing Flop..." :
                     gameState.phase === "Flop" ? "Revealing Turn..." :
                     gameState.phase === "Turn" ? "Revealing River..." :
                     "Revealing cards..."}
                  </span>
                </div>
                <p className="text-[var(--text-muted)] text-sm">
                  Decrypting community cards with Inco FHE
                </p>
                {gameState.isRevealingCommunity && (
                  <p className="text-purple-400 text-xs mt-2">
                    Submitting verification to blockchain...
                  </p>
                )}
              </div>
            )}

            {/* Action panel */}
            {currentPlayer && gameState.tableStatus === "Playing" && (
              <div className="max-w-lg mx-auto space-y-4">
                {/* Timer - shows when it's player's turn */}
                {isPlayerTurn && (
                  <div className="flex justify-center">
                    <div className="glass-dark rounded-2xl px-6 py-4">
                      <ActionTimer
                        lastActionTime={gameState.lastActionTime}
                        isPlayerTurn={isPlayerTurn ?? false}
                      />
                    </div>
                  </div>
                )}

                {/* Opponent timer - shows when waiting for another player during betting */}
                {/* Don't show when awaiting community reveal - no one should be acting */}
                {!isPlayerTurn && isBettingPhase && gameState.lastActionTime && !gameState.awaitingCommunityReveal && (
                  <OpponentTimer
                    lastActionTime={gameState.lastActionTime}
                    actionOn={gameState.actionOn}
                    onTimeout={async () => {
                      try {
                        await timeoutPlayer();
                      } catch (e) {
                        console.error("Timeout failed:", e);
                      }
                    }}
                    isLoading={loading}
                  />
                )}

                <ActionPanel
                  isPlayerTurn={isPlayerTurn ?? false}
                  canCheck={canCheck}
                  toCall={toCall}
                  minRaise={gameState.minRaise}
                  playerChips={currentPlayer.chips}
                  onFold={() => handleAction("fold")}
                  onCheck={() => handleAction("check")}
                  onCall={() => handleAction("call")}
                  onRaise={(amount) => handleAction("raise", amount)}
                  onAllIn={() => handleAction("allin")}
                  isLoading={loading}
                />

              </div>
            )}

            {/* Game History - always visible when there are events */}
            {gameEvents.length > 0 && gameState.table && (
              <div className="max-w-lg mx-auto mt-4">
                <GameHistory events={gameEvents} maxHeight="250px" />
              </div>
            )}

            {/* On-Chain Hand History - shows verified hand results from blockchain events */}
            {gameState.table && (
              <div className="max-w-lg mx-auto mt-4">
                <OnChainHandHistory
                  history={onChainHistory}
                  currentPlayerPubkey={publicKey?.toString()}
                  isListening={isHistoryListening}
                />
              </div>
            )}

            {/* No table message */}
            {!gameState.table && tableIdInput && (
              <div className="text-center py-20">
                <div className="glass inline-block px-8 py-6 rounded-2xl mb-6">
                  <p className="text-[var(--text-secondary)] text-lg">
                    Table <span className="text-[var(--text-primary)] font-medium">&quot;{tableIdInput}&quot;</span> doesn&apos;t exist yet.
                  </p>
                </div>
                <div>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="btn-gold px-8 py-4 rounded-xl font-semibold"
                  >
                    Create This Table
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Table Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass rounded-3xl p-8 max-w-md w-full relative overflow-hidden">
            {/* Modal glow */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: "radial-gradient(ellipse at top, rgba(212, 160, 18, 0.1) 0%, transparent 50%)",
              }}
            />

            <div className="relative">
              <h2 className="font-display text-2xl font-bold text-[var(--text-primary)] mb-6">
                Create Table
              </h2>

              <div className="space-y-5">
                <div>
                  <label className="block text-[var(--text-muted)] text-sm uppercase tracking-wider mb-2">
                    Table Name
                  </label>
                  <input
                    type="text"
                    value={tableIdInput}
                    onChange={(e) => setTableIdInput(e.target.value)}
                    className="w-full bg-[var(--bg-dark)] text-[var(--text-primary)] px-4 py-3 rounded-xl border border-white/5 focus:border-[var(--gold-main)] transition-colors"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[var(--text-muted)] text-sm uppercase tracking-wider mb-2">
                      Small Blind
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={createConfig.smallBlind}
                        onChange={(e) =>
                          setCreateConfig({
                            ...createConfig,
                            smallBlind: Number(e.target.value),
                          })
                        }
                        step={0.001}
                        min={0.001}
                        className="w-full bg-[var(--bg-dark)] text-[var(--text-primary)] px-4 py-3 rounded-xl border border-white/5 focus:border-[var(--gold-main)] transition-colors"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-sm">SOL</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[var(--text-muted)] text-sm uppercase tracking-wider mb-2">
                      Big Blind
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={createConfig.bigBlind}
                        onChange={(e) =>
                          setCreateConfig({
                            ...createConfig,
                            bigBlind: Number(e.target.value),
                          })
                        }
                        step={0.001}
                        min={0.001}
                        className="w-full bg-[var(--bg-dark)] text-[var(--text-primary)] px-4 py-3 rounded-xl border border-white/5 focus:border-[var(--gold-main)] transition-colors"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-sm">SOL</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[var(--text-muted)] text-sm uppercase tracking-wider mb-2">
                      Min Buy-in
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={createConfig.minBuyIn}
                        onChange={(e) =>
                          setCreateConfig({
                            ...createConfig,
                            minBuyIn: Number(e.target.value),
                          })
                        }
                        step={0.1}
                        min={0.1}
                        className="w-full bg-[var(--bg-dark)] text-[var(--text-primary)] px-4 py-3 rounded-xl border border-white/5 focus:border-[var(--gold-main)] transition-colors"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-sm">SOL</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[var(--text-muted)] text-sm uppercase tracking-wider mb-2">
                      Max Buy-in
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={createConfig.maxBuyIn}
                        onChange={(e) =>
                          setCreateConfig({
                            ...createConfig,
                            maxBuyIn: Number(e.target.value),
                          })
                        }
                        step={0.1}
                        min={0.1}
                        className="w-full bg-[var(--bg-dark)] text-[var(--text-primary)] px-4 py-3 rounded-xl border border-white/5 focus:border-[var(--gold-main)] transition-colors"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-sm">SOL</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-[var(--text-muted)] text-sm uppercase tracking-wider mb-2">
                    Max Players
                  </label>
                  <select
                    value={createConfig.maxPlayers}
                    onChange={(e) =>
                      setCreateConfig({
                        ...createConfig,
                        maxPlayers: Number(e.target.value),
                      })
                    }
                    className="w-full bg-[var(--bg-dark)] text-[var(--text-primary)] px-4 py-3 rounded-xl border border-white/5 focus:border-[var(--gold-main)] transition-colors"
                  >
                    <option value={2}>2 Players (Heads-up)</option>
                    <option value={4}>4 Players</option>
                    <option value={6}>6 Players (6-max)</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-4 mt-8">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 btn-action py-3 rounded-xl font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateTable}
                  disabled={loading || !tableIdInput}
                  className="flex-1 btn-gold py-3 rounded-xl font-semibold disabled:opacity-50"
                >
                  {loading ? "Creating..." : "Create Table"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="fixed bottom-0 w-full glass-dark py-4 text-center border-t border-white/5">
        <p className="text-[var(--text-muted)] text-sm">
          Built for{" "}
          <a
            href="https://solana.com/privacyhack"
            className="text-[var(--felt-highlight)] hover:text-[var(--felt-light)] transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            Solana Privacy Hack
          </a>
          {" "}with{" "}
          <a
            href="https://magicblock.gg"
            className="text-purple-400 hover:text-purple-300 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            MagicBlock VRF
          </a>
          {" "}&{" "}
          <a
            href="https://inco.org"
            className="text-cyan-400 hover:text-cyan-300 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            Inco FHE
          </a>
        </p>
      </footer>

      {/* Transaction Toasts */}
      <TransactionToast
        transactions={transactions}
        onDismiss={dismissTransaction}
        cluster={NETWORK === "localnet" ? "localnet" : "devnet"}
      />

    </main>
  );
}

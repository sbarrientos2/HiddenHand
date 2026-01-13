"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletButton } from "@/components/WalletButton";
import { PokerTable } from "@/components/PokerTable";
import { ActionPanel } from "@/components/ActionPanel";
import { useState, useEffect } from "react";
import { usePokerGame, type ActionType } from "@/hooks/usePokerGame";
import { NETWORK } from "@/contexts/WalletProvider";
import { solToLamports, lamportsToSol } from "@/lib/utils";

export default function Home() {
  const { connected, publicKey } = useWallet();
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
    setTableId,
  } = usePokerGame();

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

  // Auto-load table on input
  useEffect(() => {
    if (tableIdInput) {
      setTableId(tableIdInput);
    }
  }, [tableIdInput, setTableId]);

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
  const isPlayerTurn =
    currentPlayer &&
    currentPlayer.status === "playing" && // Not all-in or folded
    gameState.currentPlayerSeat !== null &&
    gameState.actionOn === currentPlayer.seatIndex &&
    gameState.phase !== "Dealing" &&
    gameState.phase !== "Showdown" &&
    gameState.phase !== "Settled" &&
    !allPlayersAllIn;

  // Calculate action panel values (never negative)
  const toCall = Math.max(0, gameState.currentBet - (currentPlayer?.currentBet ?? 0));
  const canCheck = toCall <= 0;

  // Handle player action
  const handleAction = async (action: string, amount?: number) => {
    let actionType: ActionType;
    switch (action) {
      case "fold":
        actionType = { type: "fold" };
        break;
      case "check":
        actionType = { type: "check" };
        break;
      case "call":
        actionType = { type: "call" };
        break;
      case "raise":
        actionType = { type: "raise", amount: amount ?? 0 };
        break;
      case "allin":
        actionType = { type: "allIn" };
        break;
      default:
        return;
    }

    try {
      await playerAction(actionType);
    } catch (e) {
      console.error("Action failed:", e);
    }
  };

  // Handle create table
  const handleCreateTable = async () => {
    try {
      await createTable({
        tableId: tableIdInput,
        smallBlind: solToLamports(createConfig.smallBlind),
        bigBlind: solToLamports(createConfig.bigBlind),
        minBuyIn: solToLamports(createConfig.minBuyIn),
        maxBuyIn: solToLamports(createConfig.maxBuyIn),
        maxPlayers: createConfig.maxPlayers,
      });
      setShowCreateModal(false);
    } catch (e) {
      console.error("Create failed:", e);
    }
  };

  // Handle join table
  const handleJoinTable = async () => {
    if (selectedSeat === null) return;
    try {
      await joinTable(selectedSeat, solToLamports(buyInSol));
      setSelectedSeat(null);
    } catch (e) {
      console.error("Join failed:", e);
    }
  };

  // Map game state players to component format
  const playersForTable = gameState.players.map((p) => ({
    seatIndex: p.seatIndex,
    player: p.player,
    chips: p.chips,
    currentBet: p.currentBet,
    holeCards: p.holeCards,
    status: p.status,
  }));

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

        <WalletButton className="btn-gold !text-sm !px-5 !py-2.5 !rounded-xl" />
      </header>

      {/* Main content */}
      <div className="container mx-auto px-4 py-8 pb-32">
        {!connected ? (
          /* Landing Page */
          <div className="text-center py-16">
            {/* Hero */}
            <div className="max-w-3xl mx-auto mb-16">
              <h2 className="font-display text-5xl md:text-6xl font-bold text-[var(--text-primary)] mb-6 leading-tight">
                Privacy Poker
                <br />
                <span className="text-gold-gradient">on Solana</span>
              </h2>
              <p className="text-xl text-[var(--text-secondary)] mb-10 leading-relaxed">
                The only poker game where the house can&apos;t see your cards.
                <br />
                Encrypted. On-chain. Provably fair.
              </p>
              <WalletButton className="btn-gold !text-lg !px-10 !py-4 !rounded-xl !font-bold" />
            </div>

            {/* Features */}
            <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
              {[
                {
                  icon: (
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  ),
                  title: "Encrypted Cards",
                  desc: "Your hole cards are encrypted. Only you can see them.",
                },
                {
                  icon: (
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                    </svg>
                  ),
                  title: "Fully On-Chain",
                  desc: "Every action is recorded on Solana. Provably fair.",
                },
                {
                  icon: (
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                    </svg>
                  ),
                  title: "Texas Hold'em",
                  desc: "Classic 6-max poker with blinds and all-in action.",
                },
              ].map((feature, idx) => (
                <div
                  key={idx}
                  className="glass p-6 rounded-2xl hover:border-[var(--gold-main)]/30 transition-all group"
                >
                  <div className="w-14 h-14 rounded-xl bg-[var(--felt-dark)] flex items-center justify-center text-[var(--gold-main)] mb-4 mx-auto group-hover:scale-110 transition-transform">
                    {feature.icon}
                  </div>
                  <h3 className="font-display text-lg font-bold text-[var(--text-primary)] mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-[var(--text-secondary)] text-sm">
                    {feature.desc}
                  </p>
                </div>
              ))}
            </div>
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

                    {/* Join if not at table */}
                    {!currentPlayer && gameState.tableStatus === "Waiting" && (
                      <div className="flex items-center gap-3">
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
                          disabled={loading || selectedSeat === null}
                          className="btn-info px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                        >
                          Join
                        </button>
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
                  <div className="ml-auto glass-dark border border-[var(--status-danger)]/30 rounded-xl px-4 py-2">
                    <span className="text-[var(--status-danger)] text-sm">{error}</span>
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
                              onClick={() => startHand()}
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

                        {/* Deal Cards */}
                        {gameState.phase === "Dealing" && (
                          canStart ? (
                            <button
                              onClick={() => dealCards()}
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
                      </>
                    );
                  })()}

                  {/* Showdown */}
                  {(gameState.phase === "Showdown" ||
                    (gameState.phase === "Settled" && gameState.pot > 0)) && (
                    <button
                      onClick={() => showdown()}
                      disabled={loading}
                      className="btn-gold px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                    >
                      {gameState.phase === "Showdown" ? "Run Showdown" : "Award Pot"}
                    </button>
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
              />
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

            {/* Action panel */}
            {currentPlayer && gameState.tableStatus === "Playing" && (
              <div className="max-w-lg mx-auto">
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
            href="https://inco.org"
            className="text-[var(--status-info)] hover:text-blue-300 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            Inco Lightning
          </a>
        </p>
      </footer>
    </main>
  );
}

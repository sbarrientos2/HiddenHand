"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
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
  const isPlayerTurn =
    currentPlayer &&
    gameState.currentPlayerSeat !== null &&
    gameState.actionOn === currentPlayer.seatIndex &&
    gameState.phase !== "Dealing" &&
    gameState.phase !== "Showdown" &&
    gameState.phase !== "Settled";

  // Calculate action panel values
  const toCall = gameState.currentBet - (currentPlayer?.currentBet ?? 0);
  const canCheck = toCall === 0;

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
    <main className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900">
      {/* Header */}
      <header className="p-4 flex justify-between items-center border-b border-gray-700">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-white">
            Hidden<span className="text-green-500">Hand</span>
          </h1>
          <span
            className={`text-xs px-2 py-1 rounded-full ${
              NETWORK === "localnet"
                ? "bg-purple-600 text-white"
                : "bg-yellow-600 text-white"
            }`}
          >
            {NETWORK.toUpperCase()}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <WalletMultiButton className="!bg-green-600 hover:!bg-green-500" />
        </div>
      </header>

      {/* Main content */}
      <div className="container mx-auto px-4 py-8">
        {!connected ? (
          <div className="text-center py-20">
            <h2 className="text-4xl font-bold text-white mb-4">
              Privacy Poker on Solana
            </h2>
            <p className="text-xl text-gray-400 mb-8 max-w-2xl mx-auto">
              The only poker game where the house can&apos;t see your cards.
              Connect your wallet to start playing.
            </p>
            <WalletMultiButton className="!bg-green-600 hover:!bg-green-500 !text-lg !px-8 !py-4" />

            {/* Features */}
            <div className="grid md:grid-cols-3 gap-8 mt-16 max-w-4xl mx-auto">
              <div className="bg-gray-800/50 p-6 rounded-xl">
                <div className="text-3xl mb-4">🔒</div>
                <h3 className="text-lg font-bold text-white mb-2">
                  Encrypted Cards
                </h3>
                <p className="text-gray-400 text-sm">
                  Your hole cards are encrypted. Only you can see them.
                </p>
              </div>
              <div className="bg-gray-800/50 p-6 rounded-xl">
                <div className="text-3xl mb-4">⛓️</div>
                <h3 className="text-lg font-bold text-white mb-2">
                  Fully On-Chain
                </h3>
                <p className="text-gray-400 text-sm">
                  Every action is recorded on Solana. Provably fair.
                </p>
              </div>
              <div className="bg-gray-800/50 p-6 rounded-xl">
                <div className="text-3xl mb-4">🎰</div>
                <h3 className="text-lg font-bold text-white mb-2">
                  Texas Hold&apos;em
                </h3>
                <p className="text-gray-400 text-sm">
                  Classic 6-max poker with blinds and all-in action.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Table Controls */}
            <div className="bg-gray-800/50 rounded-xl p-4">
              <div className="flex flex-wrap items-center gap-4">
                {/* Table ID input */}
                <div className="flex items-center gap-2">
                  <label className="text-gray-400 text-sm">Table:</label>
                  <input
                    type="text"
                    value={tableIdInput}
                    onChange={(e) => setTableIdInput(e.target.value)}
                    className="bg-gray-700 text-white px-3 py-2 rounded-lg text-sm w-40"
                    placeholder="Table name"
                  />
                </div>

                {/* Create / Join buttons */}
                {!gameState.table ? (
                  <button
                    onClick={() => setShowCreateModal(true)}
                    disabled={loading || !tableIdInput}
                    className="bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    Create Table
                  </button>
                ) : (
                  <>
                    {/* Table status */}
                    <div className="text-sm">
                      <span className="text-gray-400">Status: </span>
                      <span
                        className={
                          gameState.tableStatus === "Playing"
                            ? "text-green-400"
                            : gameState.tableStatus === "Waiting"
                            ? "text-yellow-400"
                            : "text-red-400"
                        }
                      >
                        {gameState.tableStatus}
                      </span>
                      <span className="text-gray-500 ml-2">
                        ({gameState.players.filter((p) => p.status !== "empty").length}/
                        {gameState.table.maxPlayers} players)
                      </span>
                    </div>

                    {/* Join if not at table */}
                    {!currentPlayer && gameState.tableStatus === "Waiting" && (
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedSeat ?? ""}
                          onChange={(e) =>
                            setSelectedSeat(
                              e.target.value ? Number(e.target.value) : null
                            )
                          }
                          className="bg-gray-700 text-white px-3 py-2 rounded-lg text-sm"
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
                        <input
                          type="number"
                          value={buyInSol}
                          onChange={(e) => setBuyInSol(Number(e.target.value))}
                          min={lamportsToSol(gameState.table.minBuyIn.toNumber())}
                          max={lamportsToSol(gameState.table.maxBuyIn.toNumber())}
                          step={0.1}
                          className="bg-gray-700 text-white px-3 py-2 rounded-lg text-sm w-24"
                        />
                        <span className="text-gray-400 text-sm">SOL</span>
                        <button
                          onClick={handleJoinTable}
                          disabled={loading || selectedSeat === null}
                          className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
                        >
                          Join
                        </button>
                      </div>
                    )}

                    {/* Leave table */}
                    {currentPlayer && gameState.tableStatus === "Waiting" && (
                      <button
                        onClick={() => leaveTable()}
                        disabled={loading}
                        className="bg-red-600 hover:bg-red-500 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
                      >
                        Leave Table
                      </button>
                    )}
                  </>
                )}

                {/* Error display */}
                {error && (
                  <div className="text-red-400 text-sm ml-auto">{error}</div>
                )}

                {/* Loading indicator */}
                {loading && (
                  <div className="text-gray-400 text-sm ml-auto flex items-center gap-2">
                    <div className="animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full" />
                    Processing...
                  </div>
                )}
              </div>
            </div>

            {/* Authority Controls (Start Hand, Deal, Showdown) */}
            {gameState.isAuthority && gameState.table && (
              <div className="bg-yellow-900/30 border border-yellow-600/50 rounded-xl p-4">
                <div className="flex items-center gap-4">
                  <span className="text-yellow-400 text-sm font-medium">
                    Table Authority Controls:
                  </span>

                  {/* Start Hand - when waiting with 2+ players */}
                  {gameState.tableStatus === "Waiting" &&
                    gameState.players.filter((p) => p.status !== "empty").length >= 2 && (
                      <button
                        onClick={() => startHand()}
                        disabled={loading}
                        className="bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
                      >
                        Start Hand
                      </button>
                    )}

                  {/* Deal Cards - when in Dealing phase */}
                  {gameState.phase === "Dealing" && (
                    <button
                      onClick={() => dealCards()}
                      disabled={loading}
                      className="bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
                    >
                      Deal Cards
                    </button>
                  )}

                  {/* Showdown - when in Showdown phase */}
                  {gameState.phase === "Showdown" && (
                    <button
                      onClick={() => showdown()}
                      disabled={loading}
                      className="bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
                    >
                      Run Showdown
                    </button>
                  )}

                  {/* Phase indicator */}
                  {gameState.tableStatus === "Playing" && (
                    <span className="text-gray-400 text-sm ml-auto">
                      Phase: <span className="text-white">{gameState.phase}</span>
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

            {/* Action panel - only show when it's player's turn */}
            {currentPlayer && gameState.tableStatus === "Playing" && (
              <div className="max-w-md mx-auto">
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
                <p className="text-gray-400 text-lg mb-4">
                  Table &quot;{tableIdInput}&quot; doesn&apos;t exist yet.
                </p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="bg-green-600 hover:bg-green-500 text-white px-6 py-3 rounded-lg font-medium"
                >
                  Create This Table
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Table Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold text-white mb-4">Create Table</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-1">
                  Table Name
                </label>
                <input
                  type="text"
                  value={tableIdInput}
                  onChange={(e) => setTableIdInput(e.target.value)}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-400 text-sm mb-1">
                    Small Blind (SOL)
                  </label>
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
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 text-sm mb-1">
                    Big Blind (SOL)
                  </label>
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
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-400 text-sm mb-1">
                    Min Buy-in (SOL)
                  </label>
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
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 text-sm mb-1">
                    Max Buy-in (SOL)
                  </label>
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
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-1">
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
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg"
                >
                  <option value={2}>2 Players (Heads-up)</option>
                  <option value={4}>4 Players</option>
                  <option value={6}>6 Players (6-max)</option>
                </select>
              </div>
            </div>

            <div className="flex gap-4 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded-lg font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTable}
                disabled={loading || !tableIdInput}
                className="flex-1 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg font-medium"
              >
                {loading ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="absolute bottom-0 w-full p-4 text-center text-gray-500 text-sm border-t border-gray-800">
        <p>
          Built for{" "}
          <a
            href="https://solana.com/privacyhack"
            className="text-green-500 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Solana Privacy Hack
          </a>{" "}
          with{" "}
          <a
            href="https://inco.org"
            className="text-blue-400 hover:underline"
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

"use client";

import { HandHistoryEntry, formatCard, getSuitColor } from "@/hooks/useHandHistory";
import { lamportsToSol } from "@/lib/utils";
import { SECONDS_PER_MINUTE, SECONDS_PER_HOUR, SECONDS_PER_DAY } from "@/lib/constants";
import { NETWORK } from "@/contexts/WalletProvider";
import { Tooltip, InfoIcon } from "@/components/Tooltip";

interface OnChainHandHistoryProps {
  history: HandHistoryEntry[];
  currentPlayerPubkey?: string;
  isListening: boolean;
}

export function OnChainHandHistory({
  history,
  currentPlayerPubkey,
  isListening,
}: OnChainHandHistoryProps) {
  const explorerUrl = NETWORK === "devnet"
    ? "https://explorer.solana.com/tx/"
    : "https://explorer.solana.com/tx/";

  const explorerSuffix = NETWORK === "devnet" ? "?cluster=devnet" : "";

  if (history.length === 0) {
    return (
      <div className="glass-dark rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <Tooltip
            title="📜 Blockchain Audit Trail"
            content="Every showdown is permanently recorded on Solana. Click 'View on Explorer' to verify any hand independently."
          >
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center cursor-help">
              On-Chain Hand History
              <InfoIcon />
            </h3>
          </Tooltip>
          <span className={`text-xs px-2 py-1 rounded-full ${isListening ? "bg-green-500/20 text-green-400" : "bg-gray-500/20 text-gray-400"}`}>
            {isListening ? "Live" : "Offline"}
          </span>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">
          No hands recorded yet. Hand history will appear here after showdowns.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-dark rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <Tooltip
          title="📜 Blockchain Audit Trail"
          content="Every showdown is permanently recorded on Solana. Click 'View on Explorer' to verify any hand independently."
        >
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center cursor-help">
            On-Chain Hand History
            <InfoIcon />
          </h3>
        </Tooltip>
        <span className={`text-xs px-2 py-1 rounded-full ${isListening ? "bg-green-500/20 text-green-400" : "bg-gray-500/20 text-gray-400"}`}>
          {isListening ? "Live" : "Offline"}
        </span>
      </div>

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {history.map((hand, idx) => (
          <div
            key={`${hand.handNumber}-${idx}`}
            className="bg-black/20 rounded-lg p-3 border border-white/5"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">
                Hand #{hand.handNumber}
              </span>
              <span className="text-xs text-[var(--text-secondary)]">
                {formatTimeAgo(hand.timestamp)}
              </span>
            </div>

            {/* Community Cards */}
            <div className="mb-2">
              <span className="text-xs text-[var(--text-secondary)]">Board: </span>
              <span className="font-mono text-base font-semibold">
                {hand.communityCards.length > 0 ? (
                  hand.communityCards.map((card, i) => (
                    <span key={i} className={`mx-0.5 ${getSuitColor(card)}`}>
                      {formatCard(card)}
                    </span>
                  ))
                ) : (
                  <span className="text-[var(--text-secondary)] text-xs font-normal">No cards</span>
                )}
              </span>
            </div>

            {/* Pot */}
            <div className="text-xs text-[var(--text-secondary)] mb-2">
              Pot: <span className="text-[var(--gold)]">{lamportsToSol(hand.totalPot).toFixed(2)} SOL</span>
            </div>

            {/* Player Results */}
            <div className="space-y-1">
              {hand.players.map((player, pIdx) => {
                const isCurrentPlayer = player.player === currentPlayerPubkey;
                const isWinner = !player.folded && player.handRank !== null;

                return (
                  <div
                    key={pIdx}
                    className={`text-xs flex items-center gap-2 ${isCurrentPlayer ? "text-[var(--gold)]" : "text-[var(--text-secondary)]"}`}
                  >
                    {/* Seat indicator */}
                    <span className="w-14">
                      Seat {player.seatIndex + 1}
                      {isCurrentPlayer && " (you)"}
                    </span>

                    {/* Cards or folded */}
                    {player.folded ? (
                      <span className="text-gray-500 italic">folded</span>
                    ) : player.holeCards ? (
                      <span className="font-mono text-base font-semibold">
                        <span className={getSuitColor(player.holeCards[0])}>
                          {formatCard(player.holeCards[0])}
                        </span>
                        {" "}
                        <span className={getSuitColor(player.holeCards[1])}>
                          {formatCard(player.holeCards[1])}
                        </span>
                      </span>
                    ) : (
                      <span className="text-gray-500">hidden</span>
                    )}

                    {/* Hand rank */}
                    {player.handRank && (
                      <span className="text-[var(--text-primary)]">
                        - {player.handRank}
                      </span>
                    )}

                    {/* All-in indicator */}
                    {player.allIn && (
                      <span className="text-orange-400 text-[10px]">ALL-IN</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Explorer Link */}
            {hand.signature && (
              <div className="mt-2 pt-2 border-t border-white/5">
                <a
                  href={`${explorerUrl}${hand.signature}${explorerSuffix}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  View on Explorer
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < SECONDS_PER_MINUTE) return `${seconds}s ago`;
  if (seconds < SECONDS_PER_HOUR) return `${Math.floor(seconds / SECONDS_PER_MINUTE)}m ago`;
  if (seconds < SECONDS_PER_DAY) return `${Math.floor(seconds / SECONDS_PER_HOUR)}h ago`;
  return date.toLocaleDateString();
}

"use client";

import { FC } from "react";
import { PlayerSeat } from "./PlayerSeat";
import { CardHand } from "./Card";
import { ProvablyFairBadge } from "./ProvablyFairBadge";
import { ChipAnimationLayer } from "./ChipAnimation";

interface Player {
  seatIndex: number;
  player: string;
  chips: number;
  currentBet: number;
  holeCards: [number | null, number | null];
  revealedCards?: [number | null, number | null];
  cardsRevealed?: boolean;
  status: "empty" | "sitting" | "playing" | "folded" | "allin";
}

interface PokerTableProps {
  tableId: string;
  phase: string;
  pot: number;
  communityCards: number[];
  currentBet: number;
  dealerPosition: number;
  actionOn: number;
  players: Player[];
  currentPlayerAddress?: string;
  smallBlind: number;
  bigBlind: number;
  isShowdownPhase?: boolean;
  isVrfVerified?: boolean; // VRF shuffle has completed
  // Chip animation triggers
  chipBetTrigger?: { seatIndex: number; amount: number; key: string } | null;
  chipWinTrigger?: { seatIndex: number; key: string } | null;
  // Win celebration
  showWinCelebration?: boolean;
  winAmount?: number;
}

// Seat positions around the table (for 6-max)
// Positions are percentages from center
const SEAT_POSITIONS = [
  { top: "88%", left: "50%", transform: "translate(-50%, -50%)" }, // Bottom center
  { top: "72%", left: "12%", transform: "translate(-50%, -50%)" }, // Bottom left
  { top: "28%", left: "12%", transform: "translate(-50%, -50%)" }, // Top left
  { top: "12%", left: "50%", transform: "translate(-50%, -50%)" }, // Top center
  { top: "28%", left: "88%", transform: "translate(-50%, -50%)" }, // Top right
  { top: "72%", left: "88%", transform: "translate(-50%, -50%)" }, // Bottom right
];

export const PokerTable: FC<PokerTableProps> = ({
  tableId,
  phase,
  pot,
  communityCards,
  currentBet,
  dealerPosition,
  actionOn,
  players,
  currentPlayerAddress,
  smallBlind,
  bigBlind,
  isShowdownPhase = false,
  isVrfVerified = false,
  chipBetTrigger = null,
  chipWinTrigger = null,
  showWinCelebration = false,
  winAmount,
}) => {
  // Calculate SB and BB positions
  const occupiedSeats = players
    .filter((p) => p.status !== "empty")
    .map((p) => p.seatIndex)
    .sort((a, b) => a - b);

  const getNextOccupied = (after: number) => {
    const idx = occupiedSeats.findIndex((s) => s > after);
    return idx >= 0 ? occupiedSeats[idx] : occupiedSeats[0];
  };

  const sbPosition = getNextOccupied(dealerPosition);
  const bbPosition = getNextOccupied(sbPosition);

  // Revealed community cards
  const revealedCards = communityCards.filter((c) => c !== 255);

  return (
    <div className="relative w-full max-w-5xl aspect-[16/10] mx-auto">
      {/* Ambient glow behind table */}
      <div
        className="absolute inset-0 rounded-[50%]"
        style={{
          background: "radial-gradient(ellipse at center, rgba(20, 90, 50, 0.4) 0%, transparent 60%)",
          filter: "blur(40px)",
        }}
      />

      {/* Outer rail (wood grain) */}
      <div
        className="absolute inset-4 rounded-[45%] shadow-2xl"
        style={{
          background: `
            linear-gradient(135deg, #3d2914 0%, #5c3d1e 20%, #7a4f24 40%, #5c3d1e 60%, #3d2914 80%, #2a1c0e 100%)
          `,
          boxShadow: `
            0 20px 60px rgba(0,0,0,0.6),
            0 0 0 4px rgba(0,0,0,0.3),
            inset 0 2px 4px rgba(255,255,255,0.1)
          `,
        }}
      >
        {/* Inner rail highlight */}
        <div
          className="absolute inset-1 rounded-[44%]"
          style={{
            background: "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, transparent 50%)",
          }}
        />

        {/* Gold trim */}
        <div
          className="absolute inset-3 rounded-[43%]"
          style={{
            border: "2px solid rgba(212, 160, 18, 0.3)",
            boxShadow: "inset 0 0 20px rgba(212, 160, 18, 0.1)",
          }}
        />
      </div>

      {/* Felt surface */}
      <div
        className="absolute inset-10 rounded-[42%] overflow-hidden"
        style={{
          backgroundImage: "url('/hiddenhand-table-bg.webp')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          boxShadow: `
            inset 0 4px 20px rgba(0,0,0,0.4),
            inset 0 0 60px rgba(0,0,0,0.2)
          `,
        }}
      >
        {/* Felt inner border */}
        <div
          className="absolute inset-3 rounded-[40%]"
          style={{
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        />

        {/* Center spotlight effect */}
        <div
          className="absolute inset-0"
          style={{
            background: "radial-gradient(ellipse at center 40%, rgba(255,255,255,0.08) 0%, transparent 50%)",
          }}
        />

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {/* Pot display */}
          <div
            className={`glass rounded-2xl px-8 py-4 mb-6 relative ${pot > 0 ? 'animate-pulse-gold' : ''}`}
            style={{
              boxShadow: pot > 0
                ? '0 0 30px rgba(212, 160, 18, 0.3), inset 0 0 20px rgba(212, 160, 18, 0.1)'
                : undefined,
            }}
          >
            <div
              className="absolute inset-0 rounded-2xl"
              style={{
                background: "linear-gradient(135deg, rgba(212, 160, 18, 0.15) 0%, transparent 50%)",
              }}
            />
            <div className="relative flex items-center justify-center gap-2">
              <span className="text-[var(--text-muted)] text-xs uppercase tracking-wider">
                Pot
              </span>
              <span className="text-gold-gradient font-display text-3xl font-bold">
                {(pot / 1e9).toFixed(2)}
              </span>
              <span className="text-[var(--gold-light)] text-lg font-semibold">SOL</span>
            </div>
          </div>

          {/* Community cards area */}
          <div className="relative px-4 py-3">
            {/* Card area background */}
            <div
              className="absolute inset-0 rounded-xl"
              style={{
                background: "rgba(0,0,0,0.2)",
                boxShadow: "inset 0 2px 8px rgba(0,0,0,0.2)",
              }}
            />

            {/* Cards */}
            <div className="relative flex gap-3">
              {[0, 1, 2, 3, 4].map((idx) => {
                const card = revealedCards[idx];
                // Determine which phase section this card belongs to
                const isFlop = idx < 3;
                const isTurn = idx === 3;
                const isRiver = idx === 4;

                return (
                  <div key={idx} className="relative">
                    {card !== undefined ? (
                      <CardHand cards={[card]} size="md" dealt />
                    ) : (
                      /* Empty card slot */
                      <div
                        className="w-16 h-[5.6rem] rounded-lg border border-dashed flex items-center justify-center transition-all duration-300"
                        style={{
                          borderColor: "rgba(255,255,255,0.1)",
                          background: "rgba(0,0,0,0.1)",
                        }}
                      >
                        <span className="text-[var(--text-muted)] text-xs opacity-50">
                          {isFlop ? (idx === 1 ? "FLOP" : "") : isTurn ? "TURN" : "RIVER"}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Phase indicator */}
          <div className="mt-5 flex items-center gap-3">
            <div
              className={`
                px-5 py-2 rounded-full uppercase tracking-widest text-sm font-semibold
                ${phase === "Showdown" || phase === "Settled"
                  ? "bg-[var(--gold-main)] text-black"
                  : "glass text-[var(--gold-light)]"
                }
              `}
            >
              {phase}
            </div>
            <ProvablyFairBadge isActive={isVrfVerified} />
          </div>

          {/* Blinds info */}
          <div className="mt-3 glass-dark inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs">
            <span className="uppercase tracking-wider text-[var(--text-secondary)]">Blinds</span>
            <span className="text-[var(--text-primary)] font-medium">
              {(smallBlind / 1e9).toFixed(2)} / {(bigBlind / 1e9).toFixed(2)} SOL
            </span>
          </div>
        </div>
      </div>

      {/* Player seats */}
      {SEAT_POSITIONS.map((pos, idx) => {
        const player = players.find((p) => p.seatIndex === idx);
        const isCurrentPlayer = player?.player === currentPlayerAddress;

        return (
          <div
            key={idx}
            className="absolute w-36"
            style={pos}
          >
            <PlayerSeat
              seatIndex={idx}
              player={player?.player}
              chips={player?.chips ?? 0}
              currentBet={player?.currentBet ?? 0}
              holeCards={player?.holeCards ?? [null, null]}
              revealedCards={player?.revealedCards}
              cardsRevealed={player?.cardsRevealed}
              isActive={player?.status === "playing" || player?.status === "allin"}
              isDealer={idx === dealerPosition}
              isSmallBlind={idx === sbPosition}
              isBigBlind={idx === bbPosition}
              isTurn={idx === actionOn && phase !== "Showdown" && phase !== "Settled"}
              status={player?.status ?? "empty"}
              isCurrentPlayer={isCurrentPlayer}
              isShowdownPhase={isShowdownPhase}
            />
          </div>
        );
      })}

      {/* Chip animations - rendered inside table for correct positioning */}
      <ChipAnimationLayer
        betTrigger={chipBetTrigger}
        winTrigger={chipWinTrigger}
        bigBlind={bigBlind}
      />

      {/* Win celebration - centered on table */}
      {showWinCelebration && (
        <div className="absolute inset-0 flex items-center justify-center z-40 pointer-events-none">
          <div
            className="relative"
            style={{
              animation: "win-banner-enter 0.5s ease-out forwards",
            }}
          >
            {/* Glow backdrop */}
            <div
              className="absolute -inset-8 rounded-3xl"
              style={{
                background: "radial-gradient(ellipse at center, rgba(212, 160, 18, 0.5) 0%, transparent 70%)",
                filter: "blur(20px)",
                animation: "win-glow-pulse 1s ease-in-out infinite",
              }}
            />

            {/* Banner content */}
            <div
              className="relative glass rounded-2xl px-10 py-5 text-center"
              style={{
                border: "2px solid rgba(212, 160, 18, 0.5)",
                boxShadow: "0 0 40px rgba(212, 160, 18, 0.3), inset 0 0 30px rgba(212, 160, 18, 0.1)",
              }}
            >
              {/* Trophy icon */}
              <div className="flex justify-center mb-2">
                <svg
                  className="w-10 h-10 text-[var(--gold-light)]"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  style={{
                    filter: "drop-shadow(0 0 10px rgba(244, 196, 48, 0.6))",
                  }}
                >
                  <path d="M12 2C13.1 2 14 2.9 14 4V5H16C16.55 5 17 5.45 17 6V8C17 9.66 15.66 11 14 11H13.82C13.4 12.84 11.85 14.22 10 14.83V17H14V19H6V17H10V14.83C8.15 14.22 6.6 12.84 6.18 11H6C4.34 11 3 9.66 3 8V6C3 5.45 3.45 5 4 5H6V4C6 2.9 6.9 2 8 2H12ZM14 7H16V8C16 8.55 15.55 9 15 9H14V7ZM6 7V9H5C4.45 9 4 8.55 4 8V7H6ZM8 4V9C8 10.66 9.34 12 11 12C12.66 12 14 10.66 14 9V4H8ZM10 20V22H14V20H10Z" />
                </svg>
              </div>

              <h2
                className="font-display text-2xl font-bold mb-1 tracking-wide"
                style={{
                  background: "linear-gradient(135deg, #f4c430 0%, #d4a012 50%, #f4c430 100%)",
                  backgroundSize: "200% 200%",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                  animation: "win-text-shimmer 2s ease-in-out infinite",
                }}
              >
                YOU WIN!
              </h2>

              {winAmount && winAmount > 0 && (
                <div className="flex items-center justify-center gap-2 text-[var(--text-primary)]">
                  <span className="text-xl font-bold text-[var(--gold-light)]">
                    +{(winAmount / 1e9).toFixed(2)}
                  </span>
                  <span className="text-sm text-[var(--text-secondary)]">SOL</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

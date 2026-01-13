"use client";

import { FC } from "react";
import { PlayerSeat } from "./PlayerSeat";
import { CardHand } from "./Card";

interface Player {
  seatIndex: number;
  player: string;
  chips: number;
  currentBet: number;
  holeCards: [number | null, number | null];
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
          <div className="mt-5 flex items-center gap-4">
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
              isActive={player?.status === "playing" || player?.status === "allin"}
              isDealer={idx === dealerPosition}
              isSmallBlind={idx === sbPosition}
              isBigBlind={idx === bbPosition}
              isTurn={idx === actionOn && phase !== "Showdown" && phase !== "Settled"}
              status={player?.status ?? "empty"}
              isCurrentPlayer={isCurrentPlayer}
            />
          </div>
        );
      })}
    </div>
  );
};

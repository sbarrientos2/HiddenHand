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
  { top: "85%", left: "50%", transform: "translate(-50%, -50%)" }, // Bottom center
  { top: "70%", left: "15%", transform: "translate(-50%, -50%)" }, // Bottom left
  { top: "30%", left: "15%", transform: "translate(-50%, -50%)" }, // Top left
  { top: "15%", left: "50%", transform: "translate(-50%, -50%)" }, // Top center
  { top: "30%", left: "85%", transform: "translate(-50%, -50%)" }, // Top right
  { top: "70%", left: "85%", transform: "translate(-50%, -50%)" }, // Bottom right
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
    <div className="relative w-full max-w-4xl aspect-[16/10] mx-auto">
      {/* Table surface */}
      <div className="absolute inset-8 bg-gradient-to-br from-green-800 to-green-900 rounded-[40%] border-8 border-amber-900 shadow-2xl">
        {/* Table felt pattern */}
        <div className="absolute inset-4 border-2 border-green-700/50 rounded-[40%]" />

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {/* Logo */}
          <div className="text-2xl font-bold text-green-600/30 mb-4">
            HiddenHand
          </div>

          {/* Pot */}
          <div className="bg-black/40 px-6 py-2 rounded-full mb-4">
            <span className="text-gray-400 text-sm">Pot: </span>
            <span className="text-white font-bold text-xl">
              {(pot / 1e9).toFixed(2)} SOL
            </span>
          </div>

          {/* Community cards */}
          <div className="flex gap-2">
            {[0, 1, 2, 3, 4].map((idx) => {
              const card = revealedCards[idx];
              return (
                <div key={idx}>
                  {card !== undefined ? (
                    <div className="transform hover:scale-105 transition-transform">
                      <CardHand cards={[card]} size="md" />
                    </div>
                  ) : (
                    <div className="w-14 h-20 bg-green-700/30 rounded-lg border-2 border-dashed border-green-600/30" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Phase indicator */}
          <div className="mt-4 bg-black/40 px-4 py-1 rounded-full">
            <span className="text-yellow-400 font-semibold text-sm uppercase">
              {phase}
            </span>
          </div>

          {/* Blinds info */}
          <div className="mt-2 text-gray-400 text-xs">
            Blinds: {(smallBlind / 1e9).toFixed(2)} / {(bigBlind / 1e9).toFixed(2)} SOL
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
            className="absolute w-32"
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

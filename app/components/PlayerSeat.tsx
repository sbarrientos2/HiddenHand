"use client";

import { FC } from "react";
import { CardHand } from "./Card";

interface PlayerSeatProps {
  seatIndex: number;
  player?: string; // Wallet address
  chips: number;
  currentBet: number;
  holeCards: [number | null, number | null];
  isActive: boolean;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  isTurn: boolean;
  status: "empty" | "sitting" | "playing" | "folded" | "allin";
  isCurrentPlayer: boolean;
}

export const PlayerSeat: FC<PlayerSeatProps> = ({
  seatIndex,
  player,
  chips,
  currentBet,
  holeCards,
  isActive,
  isDealer,
  isSmallBlind,
  isBigBlind,
  isTurn,
  status,
  isCurrentPlayer,
}) => {
  const isEmpty = status === "empty";
  const isFolded = status === "folded";

  // Format wallet address
  const shortAddress = player
    ? `${player.slice(0, 4)}...${player.slice(-4)}`
    : "Empty";

  // Position badges
  const badges = [];
  if (isDealer) badges.push({ label: "D", color: "bg-yellow-500" });
  if (isSmallBlind) badges.push({ label: "SB", color: "bg-blue-500" });
  if (isBigBlind) badges.push({ label: "BB", color: "bg-red-500" });

  return (
    <div
      className={`
        relative p-3 rounded-xl transition-all duration-300
        ${isEmpty ? "bg-gray-800/50 border-2 border-dashed border-gray-700" : "bg-gray-800 border-2 border-gray-600"}
        ${isTurn ? "ring-4 ring-yellow-400 ring-opacity-75" : ""}
        ${isFolded ? "opacity-50" : ""}
        ${isCurrentPlayer ? "border-green-500" : ""}
      `}
    >
      {/* Position badges */}
      <div className="absolute -top-2 left-1/2 -translate-x-1/2 flex gap-1">
        {badges.map((badge, idx) => (
          <span
            key={idx}
            className={`${badge.color} text-white text-xs font-bold px-2 py-0.5 rounded-full`}
          >
            {badge.label}
          </span>
        ))}
      </div>

      {/* Seat number */}
      <div className="absolute -top-2 -left-2 bg-gray-700 text-gray-300 text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
        {seatIndex + 1}
      </div>

      {isEmpty ? (
        <div className="text-center py-4">
          <p className="text-gray-500 text-sm">Empty Seat</p>
          <button className="mt-2 text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded-full transition-colors">
            Sit Here
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          {/* Player cards */}
          <div className={`${isFolded ? "grayscale" : ""}`}>
            <CardHand
              cards={holeCards}
              hidden={!isCurrentPlayer && status !== "folded"}
              size="sm"
            />
          </div>

          {/* Player info */}
          <div className="text-center">
            <p className="text-sm font-medium text-gray-200 truncate max-w-24">
              {isCurrentPlayer ? "You" : shortAddress}
            </p>
            <p className="text-lg font-bold text-yellow-400">
              {(chips / 1e9).toFixed(2)} SOL
            </p>
          </div>

          {/* Current bet */}
          {currentBet > 0 && (
            <div className="bg-gray-900/80 px-2 py-1 rounded-full">
              <span className="text-sm text-gray-400">Bet: </span>
              <span className="text-sm font-bold text-white">
                {(currentBet / 1e9).toFixed(2)}
              </span>
            </div>
          )}

          {/* Status indicator */}
          {status === "allin" && (
            <span className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              ALL IN
            </span>
          )}
          {isFolded && (
            <span className="bg-gray-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              FOLDED
            </span>
          )}
        </div>
      )}
    </div>
  );
};

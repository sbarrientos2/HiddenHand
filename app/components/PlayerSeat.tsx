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
  const isAllIn = status === "allin";

  // Format wallet address
  const shortAddress = player
    ? `${player.slice(0, 4)}...${player.slice(-4)}`
    : "Empty";

  // Position badges with refined styling
  const badges = [];
  if (isDealer)
    badges.push({
      label: "D",
      bg: "bg-gradient-to-br from-[var(--gold-light)] to-[var(--gold-dark)]",
      text: "text-black",
      shadow: "shadow-[0_0_10px_var(--gold-glow)]",
    });
  if (isSmallBlind)
    badges.push({
      label: "SB",
      bg: "bg-gradient-to-br from-[var(--chip-blue)] to-blue-700",
      text: "text-white",
      shadow: "",
    });
  if (isBigBlind)
    badges.push({
      label: "BB",
      bg: "bg-gradient-to-br from-[var(--chip-red)] to-red-800",
      text: "text-white",
      shadow: "",
    });

  return (
    <div
      className={`
        relative p-3 rounded-2xl transition-all duration-300
        ${isEmpty
          ? "opacity-60 hover:opacity-100 border border-dashed border-white/20 hover:border-[var(--gold-main)]/50 bg-black/20 hover:bg-black/40"
          : "glass-dark"
        }
        ${isTurn ? "animate-turn" : ""}
        ${isFolded ? "opacity-40" : ""}
        ${isCurrentPlayer && !isEmpty ? "ring-2 ring-[var(--felt-highlight)] ring-opacity-60" : ""}
      `}
    >
      {/* Turn indicator glow */}
      {isTurn && (
        <div
          className="absolute -inset-1 rounded-2xl pointer-events-none"
          style={{
            background: "radial-gradient(ellipse at center, rgba(212, 160, 18, 0.2) 0%, transparent 70%)",
          }}
        />
      )}

      {/* Position badges */}
      {badges.length > 0 && (
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 flex gap-1 z-10">
          {badges.map((badge, idx) => (
            <span
              key={idx}
              className={`
                ${badge.bg} ${badge.text} ${badge.shadow}
                text-[10px] font-bold px-2 py-0.5 rounded-full
                border border-white/20
              `}
            >
              {badge.label}
            </span>
          ))}
        </div>
      )}

      {/* Seat number chip */}
      <div
        className="absolute -top-2 -left-2 w-6 h-6 rounded-full flex items-center justify-center z-10"
        style={{
          background: "linear-gradient(145deg, var(--bg-elevated) 0%, var(--bg-dark) 100%)",
          border: "2px dashed rgba(255,255,255,0.15)",
          boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
        }}
      >
        <span className="text-[10px] font-bold text-[var(--text-muted)]">
          {seatIndex + 1}
        </span>
      </div>

      {isEmpty ? (
        <div className="text-center py-4 px-2 group">
          <div className="w-8 h-8 mx-auto mb-2 rounded-full border border-dashed border-white/30 flex items-center justify-center">
            <svg
              className="w-4 h-4 text-[var(--text-secondary)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          </div>
          <p className="text-[var(--text-secondary)] text-[10px] uppercase tracking-wider">Empty</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          {/* Player cards */}
          <div className={`relative ${isFolded ? "grayscale opacity-60" : ""}`}>
            <CardHand
              cards={holeCards}
              hidden={!isCurrentPlayer && status !== "folded"}
              size="sm"
              dealt
            />
            {/* Card shadow/glow for current player */}
            {isCurrentPlayer && !isFolded && (
              <div
                className="absolute -inset-2 -z-10 rounded-lg"
                style={{
                  background: "radial-gradient(ellipse at center, rgba(46, 204, 113, 0.2) 0%, transparent 70%)",
                  filter: "blur(8px)",
                }}
              />
            )}
          </div>

          {/* Player info box */}
          <div
            className="w-full rounded-lg px-2 py-1.5"
            style={{
              background: isCurrentPlayer
                ? "linear-gradient(135deg, rgba(46, 204, 113, 0.15) 0%, rgba(39, 174, 96, 0.05) 100%)"
                : "rgba(0,0,0,0.2)",
            }}
          >
            <p className="text-xs text-center truncate text-[var(--text-secondary)]">
              {isCurrentPlayer ? (
                <span className="text-[var(--status-active)]">You</span>
              ) : (
                shortAddress
              )}
            </p>
            <p className="font-display text-lg font-bold text-center text-gold-gradient">
              {(chips / 1e9).toFixed(2)}
              <span className="text-[var(--text-muted)] text-xs ml-1">SOL</span>
            </p>
          </div>

          {/* Total bet this hand */}
          {currentBet > 0 && (
            <div className="flex items-center gap-1.5 glass px-3 py-1 rounded-full">
              {/* Chip icon */}
              <div
                className="chip-indicator"
                style={{
                  background: currentBet >= chips
                    ? "var(--chip-red)"
                    : "var(--chip-green)",
                }}
              />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {(currentBet / 1e9).toFixed(2)}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase">in pot</span>
            </div>
          )}

          {/* Status badges */}
          {isAllIn && (
            <div
              className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider animate-pulse"
              style={{
                background: "linear-gradient(135deg, var(--chip-red) 0%, #8b0000 100%)",
                color: "white",
                boxShadow: "0 0 15px rgba(192, 57, 43, 0.5)",
              }}
            >
              All In
            </div>
          )}
          {isFolded && (
            <div
              className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-muted)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              Folded
            </div>
          )}
        </div>
      )}
    </div>
  );
};

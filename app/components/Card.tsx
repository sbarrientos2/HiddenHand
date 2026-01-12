"use client";

import { FC } from "react";

interface CardProps {
  card: number | null; // 0-51 or null for hidden
  hidden?: boolean;
  size?: "sm" | "md" | "lg";
}

const SUITS = ["h", "d", "c", "s"] as const;
const SUIT_SYMBOLS: Record<string, string> = {
  h: "\u2665", // Hearts
  d: "\u2666", // Diamonds
  c: "\u2663", // Clubs
  s: "\u2660", // Spades
};
const SUIT_COLORS: Record<string, string> = {
  h: "text-red-500",
  d: "text-red-500",
  c: "text-gray-900",
  s: "text-gray-900",
};
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];

const sizeClasses = {
  sm: "w-10 h-14 text-xs",
  md: "w-14 h-20 text-sm",
  lg: "w-20 h-28 text-lg",
};

export const Card: FC<CardProps> = ({ card, hidden = false, size = "md" }) => {
  if (hidden || card === null || card === 255) {
    // Card back
    return (
      <div
        className={`${sizeClasses[size]} bg-gradient-to-br from-blue-800 to-blue-900 rounded-lg border-2 border-blue-600 flex items-center justify-center shadow-lg`}
      >
        <div className="w-3/4 h-3/4 bg-blue-700 rounded border border-blue-500 flex items-center justify-center">
          <span className="text-blue-400 font-bold">HH</span>
        </div>
      </div>
    );
  }

  const suit = SUITS[Math.floor(card / 13)];
  const rank = RANKS[card % 13];
  const symbol = SUIT_SYMBOLS[suit];
  const colorClass = SUIT_COLORS[suit];

  return (
    <div
      className={`${sizeClasses[size]} bg-white rounded-lg border-2 border-gray-300 flex flex-col p-1 shadow-lg`}
    >
      <div className={`${colorClass} font-bold leading-none`}>
        {rank}
        <span className="ml-0.5">{symbol}</span>
      </div>
      <div className={`${colorClass} flex-1 flex items-center justify-center text-2xl`}>
        {symbol}
      </div>
      <div className={`${colorClass} font-bold leading-none text-right rotate-180`}>
        {rank}
        <span className="ml-0.5">{symbol}</span>
      </div>
    </div>
  );
};

// Display multiple cards
interface CardHandProps {
  cards: (number | null)[];
  hidden?: boolean;
  size?: "sm" | "md" | "lg";
}

export const CardHand: FC<CardHandProps> = ({ cards, hidden = false, size = "md" }) => {
  return (
    <div className="flex gap-1">
      {cards.map((card, idx) => (
        <Card key={idx} card={card} hidden={hidden} size={size} />
      ))}
    </div>
  );
};

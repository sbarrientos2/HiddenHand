"use client";

import { FC } from "react";

interface CardProps {
  card: number | null; // 0-51 or null for hidden
  hidden?: boolean;
  size?: "sm" | "md" | "lg";
  dealt?: boolean; // Enable deal animation
  delay?: number; // Animation delay in ms
}

const SUITS = ["h", "d", "c", "s"] as const;
const SUIT_SYMBOLS: Record<string, string> = {
  h: "\u2665", // Hearts
  d: "\u2666", // Diamonds
  c: "\u2663", // Clubs
  s: "\u2660", // Spades
};
const SUIT_NAMES: Record<string, string> = {
  h: "Hearts",
  d: "Diamonds",
  c: "Clubs",
  s: "Spades",
};
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

const sizeConfig = {
  sm: {
    card: "w-12 h-[4.2rem]",
    cornerText: "text-[10px]",
    centerSymbol: "text-lg",
    cornerGap: "gap-0",
    padding: "p-1",
  },
  md: {
    card: "w-16 h-[5.6rem]",
    cornerText: "text-xs",
    centerSymbol: "text-2xl",
    cornerGap: "gap-0.5",
    padding: "p-1.5",
  },
  lg: {
    card: "w-24 h-[8.4rem]",
    cornerText: "text-base",
    centerSymbol: "text-4xl",
    cornerGap: "gap-1",
    padding: "p-2",
  },
};

export const Card: FC<CardProps> = ({
  card,
  hidden = false,
  size = "md",
  dealt = false,
  delay = 0,
}) => {
  const config = sizeConfig[size];
  const animationStyle = dealt ? {
    animationDelay: `${delay}ms`,
    opacity: 0,
  } : {};
  const animationClass = dealt ? "animate-deal" : "";

  // Validate card is in valid range (0-51) - treat invalid cards as hidden
  // Also handle undefined (which can happen if decryption returns fewer cards than expected)
  const isInvalidCard = card != null && (card < 0 || card > 51);

  if (hidden || card == null || card === 255 || isInvalidCard) {
    // Premium card back
    return (
      <div
        className={`
          ${config.card}
          ${animationClass}
          card-back
          rounded-lg
          relative
          overflow-hidden
          shadow-lg
          transition-transform duration-200
          hover:scale-105
          hover:-translate-y-1
        `}
        style={animationStyle}
      >
        {/* Outer border glow */}
        <div className="absolute inset-0 rounded-lg border border-gold-dark/30" />

        {/* Inner pattern */}
        <div className="absolute inset-1.5 rounded-md border border-white/5 flex items-center justify-center">
          {/* Diamond pattern overlay */}
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: `repeating-linear-gradient(
                45deg,
                transparent,
                transparent 8px,
                rgba(255,255,255,0.03) 8px,
                rgba(255,255,255,0.03) 16px
              )`,
            }}
          />

          {/* Center emblem */}
          <div className="relative z-10 flex flex-col items-center">
            <div
              className="font-display text-gold-main font-bold tracking-wider"
              style={{ fontSize: size === "lg" ? "14px" : size === "md" ? "10px" : "8px" }}
            >
              HH
            </div>
            <div
              className="text-gold-dark/60"
              style={{ fontSize: size === "lg" ? "8px" : "6px" }}
            >
              {size !== "sm" && "\u2660 \u2665 \u2666 \u2663"}
            </div>
          </div>
        </div>

        {/* Corner accents */}
        <div className="absolute top-1 left-1 w-1.5 h-1.5 border-l border-t border-gold-dark/40 rounded-tl" />
        <div className="absolute top-1 right-1 w-1.5 h-1.5 border-r border-t border-gold-dark/40 rounded-tr" />
        <div className="absolute bottom-1 left-1 w-1.5 h-1.5 border-l border-b border-gold-dark/40 rounded-bl" />
        <div className="absolute bottom-1 right-1 w-1.5 h-1.5 border-r border-b border-gold-dark/40 rounded-br" />
      </div>
    );
  }

  const suit = SUITS[Math.floor(card / 13)];
  const rank = RANKS[card % 13];
  const symbol = SUIT_SYMBOLS[suit];
  const isRed = suit === "h" || suit === "d";

  const suitColorClass = isRed ? "text-red-600" : "text-gray-900";
  const suitColorStyle = isRed
    ? { color: "#c0392b", textShadow: "0 1px 2px rgba(0,0,0,0.1)" }
    : { color: "#1a1a2e", textShadow: "0 1px 2px rgba(0,0,0,0.05)" };

  return (
    <div
      className={`
        ${config.card}
        ${animationClass}
        card-face
        rounded-lg
        relative
        overflow-hidden
        flex flex-col
        ${config.padding}
        transition-all duration-200
        hover:scale-105
        hover:-translate-y-1
        hover:shadow-xl
      `}
      style={animationStyle}
      title={`${rank} of ${SUIT_NAMES[suit]}`}
    >
      {/* Top-left corner */}
      <div className={`flex flex-col items-center ${config.cornerGap} leading-none`}>
        <span
          className={`${config.cornerText} font-bold`}
          style={suitColorStyle}
        >
          {rank}
        </span>
        <span
          className={`${config.cornerText}`}
          style={suitColorStyle}
        >
          {symbol}
        </span>
      </div>

      {/* Center symbol */}
      <div
        className={`flex-1 flex items-center justify-center ${config.centerSymbol}`}
        style={suitColorStyle}
      >
        {symbol}
      </div>

      {/* Bottom-right corner (rotated) */}
      <div className={`flex flex-col items-center ${config.cornerGap} leading-none rotate-180`}>
        <span
          className={`${config.cornerText} font-bold`}
          style={suitColorStyle}
        >
          {rank}
        </span>
        <span
          className={`${config.cornerText}`}
          style={suitColorStyle}
        >
          {symbol}
        </span>
      </div>

      {/* Subtle inner glow */}
      <div className="absolute inset-0 rounded-lg pointer-events-none"
        style={{
          boxShadow: "inset 0 0 20px rgba(255,255,255,0.5)",
        }}
      />
    </div>
  );
};

// Display multiple cards
interface CardHandProps {
  cards: (number | null)[];
  hidden?: boolean;
  size?: "sm" | "md" | "lg";
  dealt?: boolean;
  staggerDelay?: number; // Delay between each card in ms
}

export const CardHand: FC<CardHandProps> = ({
  cards,
  hidden = false,
  size = "md",
  dealt = false,
  staggerDelay = 100,
}) => {
  return (
    <div className="flex gap-2">
      {cards.map((card, idx) => (
        <Card
          key={idx}
          card={card}
          hidden={hidden}
          size={size}
          dealt={dealt}
          delay={idx * staggerDelay}
        />
      ))}
    </div>
  );
};

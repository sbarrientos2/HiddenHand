"use client";

import { FC, useEffect, useRef, useState } from "react";

interface CardProps {
  card: number | null; // 0-51 or null for hidden
  hidden?: boolean;
  encrypted?: boolean; // Show encrypted state with shimmer effect
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

// Card Back Component (extracted for reuse in flip animation)
const CardBack: FC<{ config: typeof sizeConfig.md; encrypted?: boolean; size: string }> = ({
  config,
  encrypted = false,
  size,
}) => (
  <div
    className={`
      ${config.card}
      card-back
      rounded-lg
      relative
      overflow-hidden
      shadow-lg
      ${encrypted ? "encrypted-card" : ""}
    `}
    style={{ backfaceVisibility: "hidden" }}
  >
    {/* Encrypted glow effect */}
    {encrypted && (
      <div
        className="absolute -inset-1 rounded-xl pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at center, rgba(34, 211, 238, 0.15) 0%, transparent 70%)",
          filter: "blur(4px)",
        }}
      />
    )}

    {/* Outer border - cyan tint when encrypted */}
    <div
      className={`absolute inset-0 rounded-lg border ${
        encrypted ? "border-cyan-400/40" : "border-gold-dark/30"
      }`}
    />

    {/* Shimmer overlay for encrypted cards */}
    {encrypted && (
      <div
        className="absolute inset-0 rounded-lg pointer-events-none overflow-hidden"
        style={{
          background: "linear-gradient(105deg, transparent 40%, rgba(34, 211, 238, 0.08) 45%, rgba(34, 211, 238, 0.15) 50%, rgba(34, 211, 238, 0.08) 55%, transparent 60%)",
          backgroundSize: "200% 100%",
          animation: "card-shimmer 3s ease-in-out infinite",
        }}
      />
    )}

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
          className={`font-display font-bold tracking-wider ${
            encrypted ? "text-cyan-400" : "text-gold-main"
          }`}
          style={{ fontSize: size === "lg" ? "14px" : size === "md" ? "10px" : "8px" }}
        >
          {encrypted ? "🔐" : "HH"}
        </div>
        <div
          className={encrypted ? "text-cyan-400/60" : "text-gold-dark/60"}
          style={{ fontSize: size === "lg" ? "8px" : "6px" }}
        >
          {size !== "sm" && (encrypted ? "ENCRYPTED" : "\u2660 \u2665 \u2666 \u2663")}
        </div>
      </div>
    </div>

    {/* Corner accents - cyan when encrypted */}
    <div className={`absolute top-1 left-1 w-1.5 h-1.5 border-l border-t ${encrypted ? "border-cyan-400/40" : "border-gold-dark/40"} rounded-tl`} />
    <div className={`absolute top-1 right-1 w-1.5 h-1.5 border-r border-t ${encrypted ? "border-cyan-400/40" : "border-gold-dark/40"} rounded-tr`} />
    <div className={`absolute bottom-1 left-1 w-1.5 h-1.5 border-l border-b ${encrypted ? "border-cyan-400/40" : "border-gold-dark/40"} rounded-bl`} />
    <div className={`absolute bottom-1 right-1 w-1.5 h-1.5 border-r border-b ${encrypted ? "border-cyan-400/40" : "border-gold-dark/40"} rounded-br`} />

    {/* Lock badge for encrypted cards */}
    {encrypted && size !== "sm" && (
      <div
        className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center z-20"
        style={{
          background: "linear-gradient(135deg, #22d3ee 0%, #0891b2 100%)",
          boxShadow: "0 0 8px rgba(34, 211, 238, 0.5)",
        }}
      >
        <svg
          className="w-2.5 h-2.5 text-white"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
            clipRule="evenodd"
          />
        </svg>
      </div>
    )}
  </div>
);

// Card Face Component (extracted for reuse in flip animation)
const CardFace: FC<{ card: number; config: typeof sizeConfig.md }> = ({ card, config }) => {
  const suit = SUITS[Math.floor(card / 13)];
  const rank = RANKS[card % 13];
  const symbol = SUIT_SYMBOLS[suit];
  const isRed = suit === "h" || suit === "d";

  const suitColorStyle = isRed
    ? { color: "#c0392b", textShadow: "0 1px 2px rgba(0,0,0,0.1)" }
    : { color: "#1a1a2e", textShadow: "0 1px 2px rgba(0,0,0,0.05)" };

  return (
    <div
      className={`
        ${config.card}
        card-face
        rounded-lg
        relative
        overflow-hidden
        flex flex-col
        ${config.padding}
      `}
      style={{ backfaceVisibility: "hidden" }}
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

export const Card: FC<CardProps> = ({
  card,
  hidden = false,
  encrypted = false,
  size = "md",
  dealt = false,
  delay = 0,
}) => {
  const config = sizeConfig[size];
  const [isRevealing, setIsRevealing] = useState(false);
  const [showFace, setShowFace] = useState(false);
  const prevCardRef = useRef<number | null>(null);
  const hasInitializedRef = useRef(false);

  // Validate card is in valid range (0-51)
  const isValidCard = card !== null && card >= 0 && card <= 51;
  const wasValidCard = prevCardRef.current !== null && prevCardRef.current >= 0 && prevCardRef.current <= 51;

  // Detect when card transitions from hidden/invalid to valid (decrypt moment)
  useEffect(() => {
    // Skip on first render if card is already valid (no animation needed)
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      if (isValidCard && !hidden && !encrypted) {
        setShowFace(true);
      }
      prevCardRef.current = card;
      return;
    }

    // Card just became valid (decryption happened)
    if (isValidCard && !wasValidCard && !hidden && !encrypted) {
      setIsRevealing(true);

      // Midway through the flip, switch to showing the face
      const switchTimer = setTimeout(() => {
        setShowFace(true);
      }, 300); // Half of the 600ms animation

      // End the revealing animation
      const endTimer = setTimeout(() => {
        setIsRevealing(false);
      }, 600);

      prevCardRef.current = card;
      return () => {
        clearTimeout(switchTimer);
        clearTimeout(endTimer);
      };
    }

    // Card became hidden again (new hand started)
    if (!isValidCard || hidden || encrypted) {
      setShowFace(false);
      setIsRevealing(false);
    }

    prevCardRef.current = card;
  }, [card, hidden, encrypted, isValidCard, wasValidCard]);

  const animationStyle = dealt ? {
    animationDelay: `${delay}ms`,
    opacity: 0,
  } : {};
  const animationClass = dealt ? "animate-deal" : "";

  // Show card back for hidden, null, invalid, or encrypted cards (without flip)
  const showBack = hidden || card == null || card === 255 || (card !== null && (card < 0 || card > 51)) || encrypted;

  // If we're revealing (flip animation in progress), show the flip container
  if (isRevealing) {
    return (
      <div
        className={`${config.card} ${animationClass}`}
        style={{
          ...animationStyle,
          perspective: "1000px",
        }}
      >
        {/* Reveal glow effect */}
        <div
          className="absolute -inset-2 rounded-xl pointer-events-none z-10"
          style={{
            background: "radial-gradient(ellipse at center, rgba(212, 160, 18, 0.4) 0%, transparent 70%)",
            filter: "blur(8px)",
            animation: "reveal-glow 0.6s ease-out forwards",
          }}
        />

        <div
          className="relative w-full h-full"
          style={{
            transformStyle: "preserve-3d",
            animation: "card-flip 0.6s ease-out forwards",
          }}
        >
          {/* Back face (starts visible, rotates away) */}
          <div
            className="absolute inset-0"
            style={{
              transform: "rotateY(0deg)",
              backfaceVisibility: "hidden",
            }}
          >
            <CardBack config={config} encrypted={false} size={size} />
          </div>

          {/* Front face (starts hidden, rotates into view) */}
          <div
            className="absolute inset-0"
            style={{
              transform: "rotateY(180deg)",
              backfaceVisibility: "hidden",
            }}
          >
            {isValidCard && <CardFace card={card} config={config} />}
          </div>
        </div>
      </div>
    );
  }

  // Regular card back (no flip animation)
  if (showBack && !showFace) {
    return (
      <div
        className={`
          ${config.card}
          ${animationClass}
          transition-transform duration-200
          hover:scale-105
          hover:-translate-y-1
        `}
        style={animationStyle}
      >
        <CardBack config={config} encrypted={encrypted} size={size} />
      </div>
    );
  }

  // Regular card face (no flip animation)
  if (isValidCard) {
    return (
      <div
        className={`
          ${config.card}
          ${animationClass}
          transition-all duration-200
          hover:scale-105
          hover:-translate-y-1
          hover:shadow-xl
        `}
        style={animationStyle}
      >
        <CardFace card={card} config={config} />
      </div>
    );
  }

  // Fallback to card back
  return (
    <div
      className={`
        ${config.card}
        ${animationClass}
        transition-transform duration-200
        hover:scale-105
        hover:-translate-y-1
      `}
      style={animationStyle}
    >
      <CardBack config={config} encrypted={encrypted} size={size} />
    </div>
  );
};

// Display multiple cards
interface CardHandProps {
  cards: (number | null)[];
  hidden?: boolean;
  encrypted?: boolean; // Show encrypted state for all cards
  size?: "sm" | "md" | "lg";
  dealt?: boolean;
  staggerDelay?: number; // Delay between each card in ms
}

export const CardHand: FC<CardHandProps> = ({
  cards,
  hidden = false,
  encrypted = false,
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
          encrypted={encrypted}
          size={size}
          dealt={dealt}
          delay={idx * staggerDelay}
        />
      ))}
    </div>
  );
};

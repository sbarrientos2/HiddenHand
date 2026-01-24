"use client";

import { FC, useEffect, useState, useCallback } from "react";

// Seat positions - MUST match PokerTable.tsx exactly
const SEAT_POSITIONS = [
  { top: 88, left: 50 },  // Seat 0: Bottom center
  { top: 72, left: 12 },  // Seat 1: Bottom left
  { top: 28, left: 12 },  // Seat 2: Top left
  { top: 12, left: 50 },  // Seat 3: Top center
  { top: 28, left: 88 },  // Seat 4: Top right
  { top: 72, left: 88 },  // Seat 5: Bottom right
];

// Pot position (center of table)
const POT_POSITION = { top: 42, left: 50 };

interface FlyingChip {
  id: string;
  fromTop: number;
  fromLeft: number;
  toTop: number;
  toLeft: number;
  delay: number;
  size: number;
  colorIndex: number;
}

interface ChipAnimationLayerProps {
  // Bet animation: which seat just bet
  betTrigger: { seatIndex: number; amount: number; key: string } | null;
  // Win animation: which seat won
  winTrigger: { seatIndex: number; key: string } | null;
  // Big blind for determining chip count
  bigBlind: number;
}

// Chip colors matching the game's palette
const CHIP_COLORS = [
  { main: "#d4a012", edge: "#8b6914", inner: "rgba(255,255,255,0.3)" }, // Gold
  { main: "#f4c430", edge: "#d4a012", inner: "rgba(255,255,255,0.4)" }, // Light gold
  { main: "#27ae60", edge: "#1e8449", inner: "rgba(255,255,255,0.3)" }, // Green
];

const ChipIcon: FC<{ color: typeof CHIP_COLORS[0]; size: number }> = ({ color, size }) => (
  <div
    className="rounded-full relative"
    style={{
      width: size,
      height: size,
      background: `radial-gradient(circle at 35% 35%, ${color.main} 0%, ${color.edge} 100%)`,
      boxShadow: `
        inset 0 2px 3px ${color.inner},
        inset 0 -2px 3px rgba(0,0,0,0.2),
        0 3px 6px rgba(0,0,0,0.4)
      `,
    }}
  >
    {/* Chip edge dashes */}
    <div
      className="absolute inset-[3px] rounded-full"
      style={{
        border: `2px dashed rgba(255,255,255,0.3)`,
      }}
    />
  </div>
);

export const ChipAnimationLayer: FC<ChipAnimationLayerProps> = ({
  betTrigger,
  winTrigger,
  bigBlind,
}) => {
  const [chips, setChips] = useState<FlyingChip[]>([]);

  // Handle bet animation (player seat → pot)
  useEffect(() => {
    if (!betTrigger) return;

    const { seatIndex, amount, key } = betTrigger;
    const seatPos = SEAT_POSITIONS[seatIndex];
    if (!seatPos) return;

    // Determine chip count based on bet size
    const bbMultiple = bigBlind > 0 ? amount / bigBlind : 1;
    const chipCount = bbMultiple <= 2 ? 1 : bbMultiple <= 6 ? 2 : 3;

    const newChips: FlyingChip[] = [];
    for (let i = 0; i < chipCount; i++) {
      newChips.push({
        id: `${key}-${i}`,
        fromTop: seatPos.top,
        fromLeft: seatPos.left,
        toTop: POT_POSITION.top,
        toLeft: POT_POSITION.left,
        delay: i * 60,
        size: 18 + Math.random() * 6,
        colorIndex: i % CHIP_COLORS.length,
      });
    }

    setChips((prev) => [...prev, ...newChips]);

    // Remove chips after animation
    const timeout = setTimeout(() => {
      setChips((prev) => prev.filter((c) => !c.id.startsWith(key)));
    }, 600);

    return () => clearTimeout(timeout);
  }, [betTrigger, bigBlind]);

  // Handle win animation (pot → winner seat)
  useEffect(() => {
    if (!winTrigger) return;

    const { seatIndex, key } = winTrigger;
    const seatPos = SEAT_POSITIONS[seatIndex];
    if (!seatPos) return;

    // More chips for win celebration
    const chipCount = 5;
    const newChips: FlyingChip[] = [];

    for (let i = 0; i < chipCount; i++) {
      // Spread chips in a small arc from center
      const angleOffset = ((i - 2) / 2) * 0.3;
      newChips.push({
        id: `${key}-${i}`,
        fromTop: POT_POSITION.top + (Math.random() - 0.5) * 4,
        fromLeft: POT_POSITION.left + (Math.random() - 0.5) * 6,
        toTop: seatPos.top,
        toLeft: seatPos.left,
        delay: i * 40,
        size: 20 + Math.random() * 8,
        colorIndex: i % CHIP_COLORS.length,
      });
    }

    setChips((prev) => [...prev, ...newChips]);

    // Remove chips after animation
    const timeout = setTimeout(() => {
      setChips((prev) => prev.filter((c) => !c.id.startsWith(key)));
    }, 700);

    return () => clearTimeout(timeout);
  }, [winTrigger]);

  if (chips.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-30">
      {chips.map((chip) => (
        <div
          key={chip.id}
          className="absolute"
          style={{
            top: `${chip.fromTop}%`,
            left: `${chip.fromLeft}%`,
            transform: "translate(-50%, -50%)",
            animation: `chip-to-target 400ms ease-out ${chip.delay}ms forwards`,
            // CSS custom properties for animation targets
            "--from-top": `${chip.fromTop}%`,
            "--from-left": `${chip.fromLeft}%`,
            "--to-top": `${chip.toTop}%`,
            "--to-left": `${chip.toLeft}%`,
          } as React.CSSProperties}
        >
          <ChipIcon
            color={CHIP_COLORS[chip.colorIndex]}
            size={chip.size}
          />
        </div>
      ))}
    </div>
  );
};

// Hook to manage chip animation triggers
export const useChipAnimations = () => {
  const [betTrigger, setBetTrigger] = useState<{ seatIndex: number; amount: number; key: string } | null>(null);
  const [winTrigger, setWinTrigger] = useState<{ seatIndex: number; key: string } | null>(null);

  const triggerBetAnimation = useCallback((seatIndex: number, amount: number) => {
    setBetTrigger({
      seatIndex,
      amount,
      key: `bet-${Date.now()}-${seatIndex}`,
    });
  }, []);

  const triggerWinAnimation = useCallback((seatIndex: number) => {
    setWinTrigger({
      seatIndex,
      key: `win-${Date.now()}-${seatIndex}`,
    });
  }, []);

  return {
    betTrigger,
    winTrigger,
    triggerBetAnimation,
    triggerWinAnimation,
  };
};

"use client";

import { useState, useEffect } from "react";

interface ActionTimerProps {
  lastActionTime: number | null; // Unix timestamp in seconds
  timeoutSeconds?: number;
  isPlayerTurn: boolean;
}

const ACTION_TIMEOUT = 60; // 60 seconds to act

export function ActionTimer({
  lastActionTime,
  timeoutSeconds = ACTION_TIMEOUT,
  isPlayerTurn,
}: ActionTimerProps) {
  const [timeLeft, setTimeLeft] = useState<number>(timeoutSeconds);

  useEffect(() => {
    if (!lastActionTime || !isPlayerTurn) {
      setTimeLeft(timeoutSeconds);
      return;
    }

    const updateTimer = () => {
      const now = Math.floor(Date.now() / 1000);
      const elapsed = now - lastActionTime;
      const remaining = Math.max(0, timeoutSeconds - elapsed);
      setTimeLeft(remaining);
    };

    // Update immediately
    updateTimer();

    // Update every second
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [lastActionTime, timeoutSeconds, isPlayerTurn]);

  if (!isPlayerTurn) return null;

  // Calculate percentage for the circular progress
  const percentage = (timeLeft / timeoutSeconds) * 100;

  // Determine color based on time remaining
  const getColor = () => {
    if (timeLeft <= 10) return "var(--status-danger)";
    if (timeLeft <= 20) return "var(--status-warning)";
    return "var(--gold-main)";
  };

  const color = getColor();

  // SVG parameters for circular progress
  const size = 56;
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="flex items-center gap-3">
      {/* Circular Timer */}
      <div className="relative" style={{ width: size, height: size }}>
        {/* Background circle */}
        <svg
          className="absolute transform -rotate-90"
          width={size}
          height={size}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255, 255, 255, 0.1)"
            strokeWidth={strokeWidth}
          />
          {/* Progress circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            style={{
              transition: "stroke-dashoffset 0.5s ease, stroke 0.3s ease",
            }}
          />
        </svg>

        {/* Time text in center */}
        <div
          className="absolute inset-0 flex items-center justify-center font-mono text-lg font-bold"
          style={{ color }}
        >
          {timeLeft}
        </div>
      </div>

      {/* Label */}
      <div className="flex flex-col">
        <span
          className="text-xs uppercase tracking-wider font-semibold"
          style={{ color }}
        >
          {timeLeft <= 10 ? "Hurry!" : "Your Turn"}
        </span>
        <span className="text-[var(--text-muted)] text-xs">
          {timeLeft} sec left
        </span>
      </div>
    </div>
  );
}

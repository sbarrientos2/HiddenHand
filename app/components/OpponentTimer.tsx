"use client";

import { useState, useEffect } from "react";
import { ACTION_TIMEOUT_SECONDS, TIMER_UPDATE_INTERVAL_MS } from "@/lib/constants";

interface OpponentTimerProps {
  lastActionTime: number; // Unix timestamp in seconds
  actionOn: number; // Seat index of player whose turn it is
  onTimeout: () => Promise<void>;
  isLoading: boolean;
  timeoutSeconds?: number;
}

export function OpponentTimer({
  lastActionTime,
  actionOn,
  onTimeout,
  isLoading,
  timeoutSeconds = ACTION_TIMEOUT_SECONDS,
}: OpponentTimerProps) {
  const [timeLeft, setTimeLeft] = useState<number>(timeoutSeconds);
  const [canTimeout, setCanTimeout] = useState(false);

  useEffect(() => {
    if (!lastActionTime) {
      setTimeLeft(timeoutSeconds);
      setCanTimeout(false);
      return;
    }

    const updateTimer = () => {
      const now = Math.floor(Date.now() / 1000);
      const elapsed = now - lastActionTime;
      const remaining = Math.max(0, timeoutSeconds - elapsed);
      setTimeLeft(remaining);
      setCanTimeout(elapsed >= timeoutSeconds);
    };

    // Update immediately
    updateTimer();

    // Update every second
    const interval = setInterval(updateTimer, TIMER_UPDATE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [lastActionTime, timeoutSeconds]);

  // Determine display color based on time remaining
  const getColor = () => {
    if (timeLeft <= 10) return "var(--status-danger)";
    if (timeLeft <= 20) return "var(--status-warning)";
    return "var(--text-secondary)";
  };

  const color = getColor();

  return (
    <div className="flex justify-center">
      <div className="glass-dark rounded-2xl px-6 py-4">
        <div className="flex items-center gap-4">
          {/* Timer display */}
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full border-2 flex items-center justify-center font-mono font-bold"
              style={{ borderColor: color, color }}
            >
              {timeLeft}
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
                Seat {actionOn + 1}
              </span>
              <span className="text-sm" style={{ color }}>
                {canTimeout ? "Timed out!" : `${timeLeft}s left`}
              </span>
            </div>
          </div>

          {/* Timeout button - only shows when player has timed out */}
          {canTimeout && (
            <button
              onClick={onTimeout}
              disabled={isLoading}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                backgroundColor: "var(--status-danger)",
                color: "white",
                opacity: isLoading ? 0.6 : 1,
              }}
            >
              {isLoading ? "..." : "Timeout Player"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

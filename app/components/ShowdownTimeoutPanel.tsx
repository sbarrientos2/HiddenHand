"use client";

import { useState, useEffect } from "react";
import { ACTION_TIMEOUT_SECONDS, TIMER_UPDATE_INTERVAL_MS } from "@/lib/constants";

interface ShowdownTimeoutPanelProps {
  lastActionTime: number | null;
  phase: string;
  onShowdown: () => Promise<unknown>;
  isLoading: boolean;
}

export function ShowdownTimeoutPanel({
  lastActionTime,
  phase,
  onShowdown,
  isLoading,
}: ShowdownTimeoutPanelProps) {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(ACTION_TIMEOUT_SECONDS);
  const [canTrigger, setCanTrigger] = useState(false);

  useEffect(() => {
    if (!lastActionTime) {
      setSecondsRemaining(ACTION_TIMEOUT_SECONDS);
      setCanTrigger(false);
      return;
    }

    const updateTimer = () => {
      const now = Math.floor(Date.now() / 1000);
      const elapsed = now - lastActionTime;
      const remaining = Math.max(0, ACTION_TIMEOUT_SECONDS - elapsed);

      setSecondsRemaining(remaining);
      setCanTrigger(remaining === 0);
    };

    // Initial update
    updateTimer();

    // Update every second
    const interval = setInterval(updateTimer, TIMER_UPDATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [lastActionTime]);

  const buttonLabel = phase === "Showdown" ? "Run Showdown" : "Award Pot";

  return (
    <div className={`glass border rounded-2xl p-5 transition-colors ${
      canTrigger
        ? "border-[var(--gold-main)]/30"
        : "border-[var(--status-warning)]/20"
    }`}>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            canTrigger ? "bg-[var(--gold-main)]" : "bg-[var(--status-warning)] animate-pulse"
          }`} />
          <span className={`text-sm font-medium ${
            canTrigger ? "text-[var(--gold-light)]" : "text-[var(--status-warning)]"
          }`}>
            {canTrigger
              ? "Timeout reached - you can run showdown"
              : "Waiting for authority to run showdown..."
            }
          </span>
        </div>

        <button
          onClick={onShowdown}
          disabled={isLoading || !canTrigger}
          className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            canTrigger
              ? "btn-gold"
              : "bg-[var(--bg-dark)] text-[var(--text-muted)] border border-white/10 cursor-not-allowed"
          } disabled:opacity-50`}
        >
          {buttonLabel}
        </button>

        {!canTrigger && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full border-2 border-[var(--status-warning)]/30 flex items-center justify-center">
              <span className="text-[var(--status-warning)] text-xs font-bold">
                {secondsRemaining}
              </span>
            </div>
            <span className="text-[var(--text-muted)] text-xs">
              seconds until timeout
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

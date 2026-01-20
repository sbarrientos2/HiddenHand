"use client";

import { useState, useEffect } from "react";
import { TIMER_UPDATE_INTERVAL_MS } from "@/lib/constants";

interface AuthorityTimeoutPanelProps {
  lastTimestamp: number | null;
  delayBeforeShowing: number; // Seconds to wait before showing the panel
  timeoutSeconds: number; // Seconds until button becomes active (default 60)
  waitingMessage: string;
  readyMessage: string;
  buttonLabel: string;
  onAction: () => Promise<unknown>;
  isLoading: boolean;
}

export function AuthorityTimeoutPanel({
  lastTimestamp,
  delayBeforeShowing,
  timeoutSeconds,
  waitingMessage,
  readyMessage,
  buttonLabel,
  onAction,
  isLoading,
}: AuthorityTimeoutPanelProps) {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(timeoutSeconds);
  const [canTrigger, setCanTrigger] = useState(false);
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    if (!lastTimestamp) {
      setSecondsRemaining(timeoutSeconds);
      setCanTrigger(false);
      setShouldShow(false);
      return;
    }

    const updateTimer = () => {
      const now = Math.floor(Date.now() / 1000);
      const elapsed = now - lastTimestamp;
      const remaining = Math.max(0, timeoutSeconds - elapsed);

      setSecondsRemaining(remaining);
      setCanTrigger(remaining === 0);
      // Only show panel after delay has passed
      setShouldShow(elapsed >= delayBeforeShowing);
    };

    // Initial update
    updateTimer();

    // Update every second
    const interval = setInterval(updateTimer, TIMER_UPDATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [lastTimestamp, delayBeforeShowing, timeoutSeconds]);

  // Don't render if we shouldn't show yet
  if (!shouldShow) {
    return null;
  }

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
            {canTrigger ? readyMessage : waitingMessage}
          </span>
        </div>

        <button
          onClick={onAction}
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

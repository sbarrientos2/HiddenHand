"use client";

import { FC, useState, useEffect } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

interface ActionPanelProps {
  isPlayerTurn: boolean;
  canCheck: boolean;
  toCall: number;
  minRaise: number;
  playerChips: number;
  onFold: () => void;
  onCheck: () => void;
  onCall: () => void;
  onRaise: (amount: number) => void;
  onAllIn: () => void;
  isLoading?: boolean;
}

export const ActionPanel: FC<ActionPanelProps> = ({
  isPlayerTurn,
  canCheck,
  toCall,
  minRaise,
  playerChips,
  onFold,
  onCheck,
  onCall,
  onRaise,
  onAllIn,
  isLoading = false,
}) => {
  const minRaiseTotal = toCall + minRaise;
  const [raiseAmount, setRaiseAmount] = useState(minRaiseTotal);
  const [showAllInConfirm, setShowAllInConfirm] = useState(false);

  // Update raise amount when minRaise changes
  useEffect(() => {
    setRaiseAmount(Math.max(minRaiseTotal, raiseAmount));
  }, [minRaiseTotal]);

  const handleAllInClick = () => {
    setShowAllInConfirm(true);
  };

  const handleAllInConfirm = () => {
    setShowAllInConfirm(false);
    onAllIn();
  };

  if (!isPlayerTurn) {
    return (
      <div className="glass rounded-2xl p-6 text-center">
        <div className="flex items-center justify-center gap-3">
          <div className="flex gap-1">
            <div
              className="w-2 h-2 rounded-full bg-[var(--gold-main)] animate-bounce"
              style={{ animationDelay: "0ms" }}
            />
            <div
              className="w-2 h-2 rounded-full bg-[var(--gold-main)] animate-bounce"
              style={{ animationDelay: "150ms" }}
            />
            <div
              className="w-2 h-2 rounded-full bg-[var(--gold-main)] animate-bounce"
              style={{ animationDelay: "300ms" }}
            />
          </div>
          <p className="text-[var(--text-secondary)]">Waiting for other players</p>
        </div>
      </div>
    );
  }

  const canRaise = playerChips > toCall;
  const raisePercentage = ((raiseAmount - minRaiseTotal) / (playerChips - minRaiseTotal)) * 100;

  return (
    <div className="glass rounded-2xl p-5 relative overflow-hidden">
      {/* Subtle glow when it's player's turn */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at top, rgba(212, 160, 18, 0.1) 0%, transparent 50%)",
        }}
      />

      <div className="relative flex flex-col gap-5">
        {/* Header with call info */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[var(--status-active)] animate-pulse" />
            <span className="text-[var(--status-active)] text-sm font-medium uppercase tracking-wider">
              Your Turn
            </span>
          </div>
          <div className="glass-dark px-4 py-2 rounded-lg">
            <span className="text-[var(--text-muted)] text-sm">To call: </span>
            <span className="text-[var(--text-primary)] font-display font-bold">
              {(toCall / 1e9).toFixed(2)} SOL
            </span>
          </div>
        </div>

        {/* Main action buttons */}
        <div className="grid grid-cols-3 gap-3">
          <button
            onClick={onFold}
            disabled={isLoading}
            className="btn-danger py-4 rounded-xl font-bold uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            Fold
          </button>

          {canCheck ? (
            <button
              onClick={onCheck}
              disabled={isLoading}
              className="btn-info py-4 rounded-xl font-bold uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Check
            </button>
          ) : (
            <button
              onClick={onCall}
              disabled={isLoading}
              className="btn-info py-4 rounded-xl font-bold uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed transition-all flex flex-col items-center gap-0.5"
            >
              <span>{playerChips >= toCall ? "Call" : "Call All-In"}</span>
              <span className="text-xs opacity-80">
                {(Math.min(toCall, playerChips) / 1e9).toFixed(2)}
              </span>
            </button>
          )}

          <button
            onClick={handleAllInClick}
            disabled={isLoading}
            className="btn-gold py-4 rounded-xl font-bold uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed transition-all animate-pulse-gold"
          >
            All In
          </button>
        </div>

        {/* Raise controls */}
        {canRaise && (
          <div className="space-y-4 pt-2 border-t border-white/5">
            {/* Raise header */}
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-secondary)] text-sm uppercase tracking-wider">
                Raise Amount
              </span>
              <div className="glass-dark px-3 py-1.5 rounded-lg">
                <span className="font-display font-bold text-[var(--gold-light)]">
                  {(raiseAmount / 1e9).toFixed(2)}
                </span>
                <span className="text-[var(--text-muted)] text-sm ml-1">SOL</span>
              </div>
            </div>

            {/* Custom slider with visual track */}
            <div className="relative py-2">
              {/* Track background */}
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 bg-[var(--bg-dark)] rounded-full border border-white/5" />

              {/* Filled track */}
              <div
                className="absolute top-1/2 -translate-y-1/2 left-0 h-2 rounded-full"
                style={{
                  width: `${Math.max(0, Math.min(100, raisePercentage))}%`,
                  background: "linear-gradient(90deg, var(--gold-dark) 0%, var(--gold-main) 50%, var(--gold-light) 100%)",
                }}
              />

              {/* Input range */}
              <input
                type="range"
                min={minRaiseTotal}
                max={playerChips}
                value={raiseAmount}
                onChange={(e) => setRaiseAmount(Number(e.target.value))}
                className="relative z-10 w-full"
              />
            </div>

            {/* Quick bet buttons */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "Min", value: minRaiseTotal },
                { label: "2x", value: Math.min(minRaiseTotal * 2, playerChips) },
                { label: "3x", value: Math.min(minRaiseTotal * 3, playerChips) },
                { label: "Max", value: playerChips },
              ].map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => setRaiseAmount(preset.value)}
                  className={`
                    py-2 rounded-lg text-sm font-semibold transition-all
                    ${raiseAmount === preset.value
                      ? "bg-[var(--gold-main)] text-black"
                      : "btn-action hover:border-[var(--gold-main)]"
                    }
                  `}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Raise button */}
            <button
              onClick={() => onRaise(raiseAmount)}
              disabled={isLoading}
              className="btn-success w-full py-4 rounded-xl font-bold uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Raise to {(raiseAmount / 1e9).toFixed(2)} SOL
            </button>
          </div>
        )}
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-3 rounded-2xl">
          <div className="relative">
            <div className="w-10 h-10 rounded-full border-2 border-[var(--gold-main)]/30" />
            <div className="absolute inset-0 w-10 h-10 rounded-full border-2 border-transparent border-t-[var(--gold-main)] animate-spin" />
          </div>
          <p className="text-[var(--text-secondary)] text-sm">Processing transaction...</p>
        </div>
      )}

      {/* All-In Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showAllInConfirm}
        title="Confirm All-In"
        message={`You are about to go all-in with ${(playerChips / 1e9).toFixed(4)} SOL. This action cannot be undone. Are you sure?`}
        confirmLabel="Go All-In"
        cancelLabel="Cancel"
        onConfirm={handleAllInConfirm}
        onCancel={() => setShowAllInConfirm(false)}
        variant="gold"
      />
    </div>
  );
};

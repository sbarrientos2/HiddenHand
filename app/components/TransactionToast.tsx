"use client";

import { FC, useEffect, useState, useRef } from "react";

export type TransactionStatus = "pending" | "confirmed" | "error";

export interface Transaction {
  id: string;
  signature: string;
  status: TransactionStatus;
  message: string;
  timestamp: number;
  error?: string; // Error message for failed transactions
}

interface TransactionToastProps {
  transactions: Transaction[];
  onDismiss: (id: string) => void;
  cluster?: "devnet" | "mainnet-beta" | "localnet";
}

// Auto-dismiss timing (in ms)
const DISMISS_DELAY = {
  confirmed: 4000,  // 4 seconds for success
  error: 8000,      // 8 seconds for errors (more time to notice)
};

// Fade-out animation duration
const FADE_OUT_DURATION = 300;

export const TransactionToast: FC<TransactionToastProps> = ({
  transactions,
  onDismiss,
  cluster = "devnet",
}) => {
  // Track which transactions are fading out
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());
  // Track which transactions already have dismiss timers scheduled
  const scheduledRef = useRef<Set<string>>(new Set());

  // Auto-dismiss confirmed and error transactions
  useEffect(() => {
    transactions.forEach((tx) => {
      // Skip pending, already exiting, or already scheduled
      if (
        tx.status === "pending" ||
        exitingIds.has(tx.id) ||
        scheduledRef.current.has(tx.id)
      ) {
        return;
      }

      const delay = DISMISS_DELAY[tx.status];
      if (delay) {
        // Mark as scheduled
        scheduledRef.current.add(tx.id);

        // Set timer to start fade-out
        setTimeout(() => {
          setExitingIds((prev) => new Set(prev).add(tx.id));

          // After fade animation, actually dismiss
          setTimeout(() => {
            onDismiss(tx.id);
            scheduledRef.current.delete(tx.id);
          }, FADE_OUT_DURATION);
        }, delay);
      }
    });

    // Cleanup scheduled refs for transactions that no longer exist
    const currentIds = new Set(transactions.map(tx => tx.id));
    scheduledRef.current.forEach(id => {
      if (!currentIds.has(id)) {
        scheduledRef.current.delete(id);
      }
    });
  }, [transactions, exitingIds, onDismiss]);

  // Manual dismiss handler
  const handleDismiss = (id: string) => {
    if (exitingIds.has(id)) return;

    setExitingIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      onDismiss(id);
      scheduledRef.current.delete(id);
    }, FADE_OUT_DURATION);
  };

  if (transactions.length === 0) return null;

  const getExplorerUrl = (signature: string) => {
    if (cluster === "localnet") {
      return `https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=http://localhost:8899`;
    }
    return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
  };

  const statusConfig = {
    pending: {
      icon: (
        <div className="relative w-5 h-5">
          <div className="absolute inset-0 rounded-full border-2 border-[var(--gold-main)]/30" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[var(--gold-main)] animate-spin" />
        </div>
      ),
      bg: "border-[var(--gold-main)]/30",
      text: "text-[var(--gold-light)]",
    },
    confirmed: {
      icon: (
        <svg
          className="w-5 h-5 text-[var(--status-active)]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      ),
      bg: "border-[var(--status-active)]/30",
      text: "text-[var(--status-active)]",
    },
    error: {
      icon: (
        <svg
          className="w-5 h-5 text-[var(--status-danger)]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      ),
      bg: "border-[var(--status-danger)]/30",
      text: "text-[var(--status-danger)]",
    },
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {transactions.map((tx) => {
        const config = statusConfig[tx.status];
        const shortSig = `${tx.signature.slice(0, 8)}...${tx.signature.slice(-8)}`;
        const isExiting = exitingIds.has(tx.id);

        return (
          <div
            key={tx.id}
            className={`glass border ${config.bg} rounded-xl p-4 transition-all duration-300 ${
              isExiting
                ? "opacity-0 translate-x-4"
                : "animate-in slide-in-from-right fade-in duration-300"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">{config.icon}</div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${config.text}`}>
                  {tx.message}
                </p>
                {tx.error && (
                  <p className="text-xs text-[var(--status-danger)] mt-1">
                    {tx.error}
                  </p>
                )}
                {tx.signature !== "pending" && (
                <a
                  href={getExplorerUrl(tx.signature)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors font-mono"
                >
                  {shortSig}
                  <svg
                    className="inline-block w-3 h-3 ml-1"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
                )}
              </div>
              <button
                onClick={() => handleDismiss(tx.id)}
                className="flex-shrink-0 p-1 hover:bg-white/10 rounded transition-colors"
              >
                <svg
                  className="w-4 h-4 text-[var(--text-muted)]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Hook to manage transaction toasts
export const useTransactionToasts = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const addTransaction = (signature: string, message: string) => {
    const id = `${signature}-${Date.now()}`;
    setTransactions((prev) => [
      ...prev,
      {
        id,
        signature,
        status: "pending",
        message,
        timestamp: Date.now(),
      },
    ]);
    return id;
  };

  const updateTransaction = (id: string, status: TransactionStatus, signature?: string, error?: string) => {
    setTransactions((prev) =>
      prev.map((tx) => (tx.id === id ? {
        ...tx,
        status,
        ...(signature && { signature }),
        ...(error && { error }),
      } : tx))
    );
  };

  const dismissTransaction = (id: string) => {
    setTransactions((prev) => prev.filter((tx) => tx.id !== id));
  };

  return {
    transactions,
    addTransaction,
    updateTransaction,
    dismissTransaction,
  };
};

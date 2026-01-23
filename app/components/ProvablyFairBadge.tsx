"use client";

import { FC, useState } from "react";

interface ProvablyFairBadgeProps {
  isActive: boolean; // VRF shuffle has completed
  variant?: "compact" | "expanded"; // compact for in-table, expanded for info panel
}

export const ProvablyFairBadge: FC<ProvablyFairBadgeProps> = ({
  isActive,
  variant = "compact",
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  if (!isActive) return null;

  if (variant === "compact") {
    return (
      <div
        className="relative inline-flex items-center"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-help transition-all duration-300"
          style={{
            background: "linear-gradient(135deg, rgba(46, 204, 113, 0.15) 0%, rgba(39, 174, 96, 0.08) 100%)",
            border: "1px solid rgba(46, 204, 113, 0.3)",
            boxShadow: "0 0 12px rgba(46, 204, 113, 0.15)",
          }}
        >
          {/* Shield checkmark icon */}
          <svg
            className="w-3.5 h-3.5 text-emerald-400"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-emerald-400 tracking-wide uppercase">
            VRF Verified
          </span>
        </div>

        {/* Tooltip */}
        {showTooltip && (
          <div
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 z-50"
            style={{
              animation: "fade-in-up 0.2s ease-out forwards",
            }}
          >
            <div
              className="glass-dark rounded-xl p-4 text-left"
              style={{
                border: "1px solid rgba(46, 204, 113, 0.2)",
                boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <svg
                  className="w-4 h-4 text-emerald-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-emerald-400 font-semibold text-sm">
                  Provably Fair Shuffle
                </span>
              </div>
              <p className="text-[var(--text-secondary)] text-xs leading-relaxed mb-3">
                Cards were shuffled using MagicBlock VRF (Verifiable Random Function).
                The randomness is cryptographically proven and cannot be manipulated.
              </p>
              <a
                href="https://www.magicblock.xyz/blog/verifiable-randomness-solana-plugin"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-emerald-400/80 hover:text-emerald-400 transition-colors"
              >
                Learn more
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
            {/* Tooltip arrow */}
            <div
              className="absolute top-full left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 -mt-1.5"
              style={{
                background: "var(--bg-dark)",
                borderRight: "1px solid rgba(46, 204, 113, 0.2)",
                borderBottom: "1px solid rgba(46, 204, 113, 0.2)",
              }}
            />
          </div>
        )}
      </div>
    );
  }

  // Expanded variant for info panels or sidebars
  return (
    <div
      className="flex items-start gap-3 p-4 rounded-xl"
      style={{
        background: "linear-gradient(135deg, rgba(46, 204, 113, 0.1) 0%, rgba(39, 174, 96, 0.05) 100%)",
        border: "1px solid rgba(46, 204, 113, 0.2)",
      }}
    >
      <div
        className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
        style={{
          background: "linear-gradient(135deg, rgba(46, 204, 113, 0.2) 0%, rgba(39, 174, 96, 0.1) 100%)",
        }}
      >
        <svg
          className="w-5 h-5 text-emerald-400"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      <div className="flex-1">
        <h4 className="text-emerald-400 font-semibold text-sm mb-1">
          Provably Fair Shuffle
        </h4>
        <p className="text-[var(--text-secondary)] text-xs leading-relaxed mb-2">
          This hand was shuffled using MagicBlock VRF. The randomness is cryptographically
          verifiable on-chain.
        </p>
        <a
          href="https://www.magicblock.xyz/blog/verifiable-randomness-solana-plugin"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-emerald-400/80 hover:text-emerald-400 transition-colors"
        >
          Learn about VRF
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
    </div>
  );
};

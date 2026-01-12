"use client";

import { FC, useState } from "react";

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
  const [raiseAmount, setRaiseAmount] = useState(minRaise);

  if (!isPlayerTurn) {
    return (
      <div className="bg-gray-800 rounded-xl p-4 text-center">
        <p className="text-gray-400">Waiting for other players...</p>
      </div>
    );
  }

  const minRaiseTotal = toCall + minRaise;
  const canRaise = playerChips > toCall;

  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <div className="flex flex-col gap-4">
        {/* Info row */}
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">To call:</span>
          <span className="text-white font-bold">{(toCall / 1e9).toFixed(2)} SOL</span>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={onFold}
            disabled={isLoading}
            className="flex-1 bg-red-600 hover:bg-red-500 disabled:bg-gray-600 text-white font-bold py-3 px-4 rounded-lg transition-colors"
          >
            Fold
          </button>

          {canCheck ? (
            <button
              onClick={onCheck}
              disabled={isLoading}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white font-bold py-3 px-4 rounded-lg transition-colors"
            >
              Check
            </button>
          ) : (
            <button
              onClick={onCall}
              disabled={isLoading || playerChips < toCall}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white font-bold py-3 px-4 rounded-lg transition-colors"
            >
              Call {(toCall / 1e9).toFixed(2)}
            </button>
          )}

          <button
            onClick={onAllIn}
            disabled={isLoading}
            className="flex-1 bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-600 text-white font-bold py-3 px-4 rounded-lg transition-colors"
          >
            All In
          </button>
        </div>

        {/* Raise controls */}
        {canRaise && (
          <div className="space-y-2">
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={minRaiseTotal}
                max={playerChips}
                value={raiseAmount}
                onChange={(e) => setRaiseAmount(Number(e.target.value))}
                className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
              />
              <span className="text-white font-bold w-24 text-right">
                {(raiseAmount / 1e9).toFixed(2)} SOL
              </span>
            </div>

            {/* Quick raise buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => setRaiseAmount(minRaiseTotal)}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm py-1 rounded transition-colors"
              >
                Min
              </button>
              <button
                onClick={() => setRaiseAmount(Math.min(minRaiseTotal * 2, playerChips))}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm py-1 rounded transition-colors"
              >
                2x
              </button>
              <button
                onClick={() => setRaiseAmount(Math.min(minRaiseTotal * 3, playerChips))}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm py-1 rounded transition-colors"
              >
                3x
              </button>
              <button
                onClick={() => setRaiseAmount(playerChips)}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm py-1 rounded transition-colors"
              >
                Max
              </button>
            </div>

            <button
              onClick={() => onRaise(raiseAmount)}
              disabled={isLoading}
              className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white font-bold py-3 px-4 rounded-lg transition-colors"
            >
              Raise to {(raiseAmount / 1e9).toFixed(2)} SOL
            </button>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="mt-4 text-center">
          <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
          <p className="text-gray-400 text-sm mt-2">Processing...</p>
        </div>
      )}
    </div>
  );
};

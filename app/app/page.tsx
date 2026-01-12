"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PokerTable } from "@/components/PokerTable";
import { ActionPanel } from "@/components/ActionPanel";
import { useState } from "react";

// Mock data for demo
const MOCK_PLAYERS = [
  {
    seatIndex: 0,
    player: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    chips: 5_000_000_000, // 5 SOL
    currentBet: 200_000_000, // 0.2 SOL (BB)
    holeCards: [12, 25] as [number, number], // Ah, Kd
    status: "playing" as const,
  },
  {
    seatIndex: 1,
    player: "2xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgXYZ",
    chips: 3_500_000_000,
    currentBet: 0,
    holeCards: [null, null] as [number | null, number | null],
    status: "playing" as const,
  },
  {
    seatIndex: 3,
    player: "3xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgABC",
    chips: 2_800_000_000,
    currentBet: 100_000_000, // 0.1 SOL (SB)
    holeCards: [null, null] as [number | null, number | null],
    status: "playing" as const,
  },
  {
    seatIndex: 5,
    player: "4xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgDEF",
    chips: 0,
    currentBet: 4_200_000_000,
    holeCards: [null, null] as [number | null, number | null],
    status: "allin" as const,
  },
];

export default function Home() {
  const { connected, publicKey } = useWallet();
  const [isLoading, setIsLoading] = useState(false);

  // Mock current player (for demo, use first player)
  const mockCurrentPlayer = MOCK_PLAYERS[0].player;

  const handleAction = async (action: string, amount?: number) => {
    setIsLoading(true);
    console.log("Action:", action, amount);
    // Simulate transaction delay
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setIsLoading(false);
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900">
      {/* Header */}
      <header className="p-4 flex justify-between items-center border-b border-gray-700">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-white">
            Hidden<span className="text-green-500">Hand</span>
          </h1>
          <span className="text-xs bg-yellow-600 text-white px-2 py-1 rounded-full">
            DEVNET
          </span>
        </div>

        <div className="flex items-center gap-4">
          <WalletMultiButton className="!bg-green-600 hover:!bg-green-500" />
        </div>
      </header>

      {/* Main content */}
      <div className="container mx-auto px-4 py-8">
        {!connected ? (
          <div className="text-center py-20">
            <h2 className="text-4xl font-bold text-white mb-4">
              Privacy Poker on Solana
            </h2>
            <p className="text-xl text-gray-400 mb-8 max-w-2xl mx-auto">
              The only poker game where the house can&apos;t see your cards.
              Connect your wallet to start playing.
            </p>
            <WalletMultiButton className="!bg-green-600 hover:!bg-green-500 !text-lg !px-8 !py-4" />

            {/* Features */}
            <div className="grid md:grid-cols-3 gap-8 mt-16 max-w-4xl mx-auto">
              <div className="bg-gray-800/50 p-6 rounded-xl">
                <div className="text-3xl mb-4">🔒</div>
                <h3 className="text-lg font-bold text-white mb-2">
                  Encrypted Cards
                </h3>
                <p className="text-gray-400 text-sm">
                  Your hole cards are encrypted. Only you can see them.
                </p>
              </div>
              <div className="bg-gray-800/50 p-6 rounded-xl">
                <div className="text-3xl mb-4">⛓️</div>
                <h3 className="text-lg font-bold text-white mb-2">
                  Fully On-Chain
                </h3>
                <p className="text-gray-400 text-sm">
                  Every action is recorded on Solana. Provably fair.
                </p>
              </div>
              <div className="bg-gray-800/50 p-6 rounded-xl">
                <div className="text-3xl mb-4">🎰</div>
                <h3 className="text-lg font-bold text-white mb-2">
                  Texas Hold&apos;em
                </h3>
                <p className="text-gray-400 text-sm">
                  Classic 6-max poker with blinds and all-in action.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Poker table */}
            <PokerTable
              tableId="demo-table"
              phase="PreFlop"
              pot={4_500_000_000}
              communityCards={[255, 255, 255, 255, 255]} // Hidden
              currentBet={200_000_000}
              dealerPosition={1}
              actionOn={0}
              players={MOCK_PLAYERS}
              currentPlayerAddress={mockCurrentPlayer}
              smallBlind={100_000_000}
              bigBlind={200_000_000}
            />

            {/* Action panel */}
            <div className="max-w-md mx-auto">
              <ActionPanel
                isPlayerTurn={true}
                canCheck={false}
                toCall={200_000_000}
                minRaise={200_000_000}
                playerChips={MOCK_PLAYERS[0].chips}
                onFold={() => handleAction("fold")}
                onCheck={() => handleAction("check")}
                onCall={() => handleAction("call")}
                onRaise={(amount) => handleAction("raise", amount)}
                onAllIn={() => handleAction("allin")}
                isLoading={isLoading}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="absolute bottom-0 w-full p-4 text-center text-gray-500 text-sm border-t border-gray-800">
        <p>
          Built for{" "}
          <a
            href="https://solana.com/privacyhack"
            className="text-green-500 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Solana Privacy Hack
          </a>{" "}
          with{" "}
          <a
            href="https://inco.org"
            className="text-blue-400 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Inco Lightning
          </a>
        </p>
      </footer>
    </main>
  );
}

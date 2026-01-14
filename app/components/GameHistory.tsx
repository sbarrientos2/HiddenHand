"use client";

import { FC, useRef, useEffect } from "react";
import { decodeCard } from "@/lib/utils";

export interface GameEvent {
  id: string;
  type: "action" | "phase" | "cards" | "winner" | "system";
  timestamp: number;
  message: string;
  seatIndex?: number;
  playerAddress?: string;
  amount?: number;
  cards?: number[];
}

interface GameHistoryProps {
  events: GameEvent[];
  maxHeight?: string;
}

export const GameHistory: FC<GameHistoryProps> = ({
  events,
  maxHeight = "300px",
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  const getEventIcon = (type: GameEvent["type"]) => {
    switch (type) {
      case "action":
        return (
          <div className="w-2 h-2 rounded-full bg-[var(--gold-main)]" />
        );
      case "phase":
        return (
          <div className="w-2 h-2 rounded-full bg-[var(--status-active)]" />
        );
      case "cards":
        return (
          <div className="w-2 h-2 rounded-full bg-purple-400" />
        );
      case "winner":
        return (
          <div className="w-4 h-4 flex items-center justify-center text-sm">🏆</div>
        );
      case "system":
        return (
          <div className="w-2 h-2 rounded-full bg-[var(--text-muted)]" />
        );
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const formatCard = (card: number) => {
    const cardNum = Number(card); // Ensure it's a number
    const decoded = decodeCard(cardNum);
    if (!decoded) {
      return <span className="text-[var(--text-muted)]">?</span>;
    }
    const colorClass = decoded.isRed ? "text-red-500" : "text-[var(--text-primary)]";
    return (
      <span className={`font-bold ${colorClass}`}>
        {decoded.rank}{decoded.suitSymbol}
      </span>
    );
  };

  // Get color class for action messages
  const getActionColor = (message: string): string => {
    if (message.includes("Fold")) return "text-[var(--status-danger)]";
    if (message.includes("All-In")) return "text-purple-400 font-semibold";
    if (message.includes("Raise")) return "text-[var(--gold-light)]";
    if (message.includes("Call") || message.includes("Check")) return "text-[var(--text-secondary)]";
    return "text-[var(--text-secondary)]";
  };

  if (events.length === 0) {
    return (
      <div className="glass rounded-xl p-4">
        <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
          Hand History
        </h3>
        <p className="text-[var(--text-muted)] text-sm italic">
          No events yet. Start a hand to see the action log.
        </p>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl p-4">
      <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
        Hand History
      </h3>
      <div
        ref={scrollRef}
        className="space-y-2 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
        style={{ maxHeight }}
      >
        {events.map((event) => {
          // Special styling for different event types
          const isWinner = event.type === "winner";
          const isSystem = event.type === "system";
          const isSeparator = isSystem && event.message.includes("━━━");

          if (isSeparator) {
            return (
              <div
                key={event.id}
                className="text-center py-2 text-[var(--text-muted)] text-xs animate-in fade-in duration-200"
              >
                {event.message}
              </div>
            );
          }

          return (
            <div
              key={event.id}
              className={`flex items-start gap-2 text-sm animate-in fade-in slide-in-from-bottom-2 duration-200 ${
                isWinner ? "bg-green-500/10 -mx-2 px-2 py-1 rounded-lg" : ""
              }`}
            >
              <div className="flex-shrink-0 mt-1.5">{getEventIcon(event.type)}</div>
              <div className="flex-1 min-w-0">
                <span className="text-[var(--text-muted)] text-xs mr-2">
                  {formatTime(event.timestamp)}
                </span>
                <span className={
                  isWinner
                    ? "text-green-400 font-semibold"
                    : event.type === "action"
                    ? getActionColor(event.message)
                    : "text-[var(--text-secondary)]"
                }>
                  {event.message}
                  {event.cards && event.cards.length > 0 && (
                    <span className="ml-2">
                      {event.cards.map((card, i) => (
                        <span key={i}>
                          {i > 0 && " "}
                          {formatCard(card)}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Hook to manage game events
import { useState, useCallback } from "react";

export const useGameHistory = () => {
  const [events, setEvents] = useState<GameEvent[]>([]);

  const addEvent = useCallback((
    type: GameEvent["type"],
    message: string,
    extras?: Partial<Omit<GameEvent, "id" | "type" | "timestamp" | "message">>
  ) => {
    const event: GameEvent = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      timestamp: Date.now(),
      message,
      ...extras,
    };
    setEvents((prev) => [...prev, event]);
  }, []);

  const clearHistory = useCallback(() => {
    setEvents([]);
  }, []);

  return {
    events,
    addEvent,
    clearHistory,
  };
};

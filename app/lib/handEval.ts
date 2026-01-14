/**
 * Hand evaluation for Texas Hold'em poker
 * Ported from Rust implementation in programs/hiddenhand/src/state/hand_eval.rs
 */

export type HandRank =
  | "High Card"
  | "One Pair"
  | "Two Pair"
  | "Three of a Kind"
  | "Straight"
  | "Flush"
  | "Full House"
  | "Four of a Kind"
  | "Straight Flush"
  | "Royal Flush";

const HAND_RANK_VALUES: Record<HandRank, number> = {
  "High Card": 0,
  "One Pair": 1,
  "Two Pair": 2,
  "Three of a Kind": 3,
  "Straight": 4,
  "Flush": 5,
  "Full House": 6,
  "Four of a Kind": 7,
  "Straight Flush": 8,
  "Royal Flush": 9,
};

export interface EvaluatedHand {
  rank: HandRank;
  kickers: number[]; // For tiebreaking
}

/** Get rank (0-12, where 0=2, 12=Ace) from card value */
function getRank(card: number): number {
  return card % 13;
}

/** Get suit (0-3) from card value */
function getSuit(card: number): number {
  return Math.floor(card / 13);
}

/** Check if sorted ranks (descending) form a straight */
function isStraightRanks(ranks: number[]): boolean {
  for (let i = 0; i < 4; i++) {
    if (ranks[i] !== ranks[i + 1] + 1) {
      return false;
    }
  }
  return true;
}

/** Evaluate exactly 5 cards */
function evaluateFiveCards(cards: number[]): EvaluatedHand {
  // Extract ranks and suits
  const ranks = cards.map(getRank).sort((a, b) => b - a);
  const suits = cards.map(getSuit);

  // Check for flush (all same suit)
  const isFlush = suits.every((s) => s === suits[0]);

  // Check for straight
  const isStraight = isStraightRanks(ranks);

  // Check for wheel (A-2-3-4-5)
  const isWheel =
    ranks[0] === 12 &&
    ranks[1] === 3 &&
    ranks[2] === 2 &&
    ranks[3] === 1 &&
    ranks[4] === 0;

  // Straight flush / Royal flush
  if (isFlush && (isStraight || isWheel)) {
    if (isWheel) {
      return {
        rank: "Straight Flush",
        kickers: [3, 0, 0, 0, 0], // 5-high straight flush
      };
    }
    if (ranks[0] === 12) {
      // Ace high
      return {
        rank: "Royal Flush",
        kickers: [12, 11, 10, 9, 8],
      };
    }
    return {
      rank: "Straight Flush",
      kickers: [ranks[0], 0, 0, 0, 0],
    };
  }

  // Count rank occurrences
  const rankCounts = new Array(13).fill(0);
  for (const r of ranks) {
    rankCounts[r]++;
  }

  // Find pairs, trips, quads
  let quads: number | null = null;
  let trips: number | null = null;
  const pairs: number[] = [];
  const singles: number[] = [];

  // Iterate from Ace down to 2
  for (let r = 12; r >= 0; r--) {
    switch (rankCounts[r]) {
      case 4:
        quads = r;
        break;
      case 3:
        trips = r;
        break;
      case 2:
        pairs.push(r);
        break;
      case 1:
        singles.push(r);
        break;
    }
  }

  // Four of a kind
  if (quads !== null) {
    const kicker = singles[0] ?? pairs[0] ?? trips ?? 0;
    return {
      rank: "Four of a Kind",
      kickers: [quads, kicker, 0, 0, 0],
    };
  }

  // Full house
  if (trips !== null && pairs.length > 0) {
    return {
      rank: "Full House",
      kickers: [trips, pairs[0], 0, 0, 0],
    };
  }

  // Flush
  if (isFlush) {
    return {
      rank: "Flush",
      kickers: [...ranks],
    };
  }

  // Straight
  if (isStraight) {
    return {
      rank: "Straight",
      kickers: [ranks[0], 0, 0, 0, 0],
    };
  }
  if (isWheel) {
    return {
      rank: "Straight",
      kickers: [3, 0, 0, 0, 0], // 5-high
    };
  }

  // Three of a kind
  if (trips !== null) {
    return {
      rank: "Three of a Kind",
      kickers: [trips, singles[0] ?? 0, singles[1] ?? 0, 0, 0],
    };
  }

  // Two pair
  if (pairs.length >= 2) {
    return {
      rank: "Two Pair",
      kickers: [pairs[0], pairs[1], singles[0] ?? 0, 0, 0],
    };
  }

  // One pair
  if (pairs.length === 1) {
    return {
      rank: "One Pair",
      kickers: [pairs[0], singles[0] ?? 0, singles[1] ?? 0, singles[2] ?? 0, 0],
    };
  }

  // High card
  return {
    rank: "High Card",
    kickers: [...ranks],
  };
}

/** Compare two hands. Returns positive if a wins, negative if b wins, 0 if tie */
function compareHands(a: EvaluatedHand, b: EvaluatedHand): number {
  const rankDiff = HAND_RANK_VALUES[a.rank] - HAND_RANK_VALUES[b.rank];
  if (rankDiff !== 0) return rankDiff;

  // Same rank, compare kickers
  for (let i = 0; i < 5; i++) {
    const kickerDiff = a.kickers[i] - b.kickers[i];
    if (kickerDiff !== 0) return kickerDiff;
  }
  return 0;
}

/**
 * Evaluate the best 5-card hand from 7 cards
 * @param cards Array of 7 card values (0-51)
 * @returns The best evaluated hand
 */
export function evaluateHand(cards: number[]): EvaluatedHand {
  if (cards.length < 5) {
    return { rank: "High Card", kickers: [0, 0, 0, 0, 0] };
  }

  // If exactly 5 cards, evaluate directly
  if (cards.length === 5) {
    return evaluateFiveCards(cards);
  }

  let bestHand: EvaluatedHand | null = null;

  // Generate all 21 combinations of 5 cards from 7
  for (let i = 0; i < cards.length - 4; i++) {
    for (let j = i + 1; j < cards.length - 3; j++) {
      for (let k = j + 1; k < cards.length - 2; k++) {
        for (let l = k + 1; l < cards.length - 1; l++) {
          for (let m = l + 1; m < cards.length; m++) {
            const fiveCards = [cards[i], cards[j], cards[k], cards[l], cards[m]];
            const evaluated = evaluateFiveCards(fiveCards);

            if (bestHand === null || compareHands(evaluated, bestHand) > 0) {
              bestHand = evaluated;
            }
          }
        }
      }
    }
  }

  return bestHand!;
}

/**
 * Get a human-readable description of a hand rank with high card info
 * @param hand The evaluated hand
 * @returns String like "Flush" or "Pair of Aces"
 */
export function getHandDescription(hand: EvaluatedHand): string {
  const rankNames = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

  switch (hand.rank) {
    case "Royal Flush":
      return "Royal Flush";
    case "Straight Flush":
      return `Straight Flush (${rankNames[hand.kickers[0]]}-high)`;
    case "Four of a Kind":
      return `Four ${rankNames[hand.kickers[0]]}s`;
    case "Full House":
      return `Full House (${rankNames[hand.kickers[0]]}s full of ${rankNames[hand.kickers[1]]}s)`;
    case "Flush":
      return `Flush (${rankNames[hand.kickers[0]]}-high)`;
    case "Straight":
      return `Straight (${rankNames[hand.kickers[0]]}-high)`;
    case "Three of a Kind":
      return `Three ${rankNames[hand.kickers[0]]}s`;
    case "Two Pair":
      return `Two Pair (${rankNames[hand.kickers[0]]}s and ${rankNames[hand.kickers[1]]}s)`;
    case "One Pair":
      return `Pair of ${rankNames[hand.kickers[0]]}s`;
    case "High Card":
      return `${rankNames[hand.kickers[0]]}-high`;
    default:
      return hand.rank;
  }
}

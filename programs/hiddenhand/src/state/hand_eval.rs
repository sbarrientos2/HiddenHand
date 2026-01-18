use anchor_lang::prelude::*;

/// Hand ranking from highest to lowest
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, PartialOrd, Ord)]
#[repr(u8)]
pub enum HandRank {
    HighCard = 0,
    OnePair = 1,
    TwoPair = 2,
    ThreeOfAKind = 3,
    Straight = 4,
    Flush = 5,
    FullHouse = 6,
    FourOfAKind = 7,
    StraightFlush = 8,
    RoyalFlush = 9,
}

/// Evaluated hand with rank and tiebreaker values
/// The kickers array allows comparing hands of same rank
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct EvaluatedHand {
    /// Primary hand ranking
    pub rank: HandRank,
    /// Tiebreaker values (descending importance)
    /// For pair: [pair_rank, kicker1, kicker2, kicker3]
    /// For two pair: [high_pair, low_pair, kicker]
    /// For full house: [trips_rank, pair_rank]
    /// etc.
    pub kickers: [u8; 5],
}

impl EvaluatedHand {
    /// Compare two hands. Returns:
    /// - Ordering::Greater if self wins
    /// - Ordering::Less if other wins
    /// - Ordering::Equal if tie (split pot)
    pub fn compare(&self, other: &EvaluatedHand) -> std::cmp::Ordering {
        // First compare rank
        match (self.rank as u8).cmp(&(other.rank as u8)) {
            std::cmp::Ordering::Equal => {
                // Same rank, compare kickers
                for i in 0..5 {
                    match self.kickers[i].cmp(&other.kickers[i]) {
                        std::cmp::Ordering::Equal => continue,
                        ord => return ord,
                    }
                }
                std::cmp::Ordering::Equal
            }
            ord => ord,
        }
    }
}

/// Get rank (0-12, where 0=2, 12=Ace) from card value
#[inline]
pub fn get_rank(card: u8) -> u8 {
    card % 13
}

/// Get suit (0-3) from card value
#[inline]
pub fn get_suit(card: u8) -> u8 {
    card / 13
}

/// Evaluate the best 5-card hand from 7 cards
/// Returns the evaluated hand with rank and kickers
pub fn evaluate_hand(cards: &[u8; 7]) -> EvaluatedHand {
    let mut best_hand: Option<EvaluatedHand> = None;

    // Generate all 21 combinations of 5 cards from 7
    // Using indices: (0,1,2,3,4), (0,1,2,3,5), ..., (2,3,4,5,6)
    for i in 0..3 {
        for j in (i + 1)..4 {
            for k in (j + 1)..5 {
                for l in (k + 1)..6 {
                    for m in (l + 1)..7 {
                        let five_cards = [
                            cards[i],
                            cards[j],
                            cards[k],
                            cards[l],
                            cards[m],
                        ];
                        let eval = evaluate_five_cards(&five_cards);

                        match &best_hand {
                            None => best_hand = Some(eval),
                            Some(best) => {
                                if eval.compare(best) == std::cmp::Ordering::Greater {
                                    best_hand = Some(eval);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    best_hand.unwrap()
}

/// Evaluate exactly 5 cards
fn evaluate_five_cards(cards: &[u8; 5]) -> EvaluatedHand {
    // Extract ranks and suits
    let mut ranks: [u8; 5] = cards.map(get_rank);
    let suits: [u8; 5] = cards.map(get_suit);

    // Sort ranks descending for easier evaluation
    ranks.sort_by(|a, b| b.cmp(a));

    // Check for flush (all same suit)
    let is_flush = suits[0] == suits[1]
        && suits[1] == suits[2]
        && suits[2] == suits[3]
        && suits[3] == suits[4];

    // Check for straight
    let is_straight = is_straight_ranks(&ranks);

    // Check for wheel (A-2-3-4-5)
    let is_wheel = ranks == [12, 3, 2, 1, 0];

    // Straight flush / Royal flush
    if is_flush && (is_straight || is_wheel) {
        if is_wheel {
            return EvaluatedHand {
                rank: HandRank::StraightFlush,
                kickers: [3, 0, 0, 0, 0], // 5-high straight flush
            };
        }
        if ranks[0] == 12 { // Ace high
            return EvaluatedHand {
                rank: HandRank::RoyalFlush,
                kickers: [12, 11, 10, 9, 8],
            };
        }
        return EvaluatedHand {
            rank: HandRank::StraightFlush,
            kickers: [ranks[0], 0, 0, 0, 0],
        };
    }

    // Count rank occurrences
    let mut rank_counts = [0u8; 13];
    for &r in &ranks {
        rank_counts[r as usize] += 1;
    }

    // Find pairs, trips, quads
    let mut quads: Option<u8> = None;
    let mut trips: Option<u8> = None;
    let mut pairs: Vec<u8> = Vec::new();
    let mut singles: Vec<u8> = Vec::new();

    // Iterate from Ace down to 2
    for r in (0..13).rev() {
        match rank_counts[r] {
            4 => quads = Some(r as u8),
            3 => trips = Some(r as u8),
            2 => pairs.push(r as u8),
            1 => singles.push(r as u8),
            _ => {}
        }
    }

    // Four of a kind
    if let Some(quad_rank) = quads {
        let kicker = singles.first().copied()
            .or_else(|| pairs.first().copied())
            .or_else(|| trips)
            .unwrap_or(0);
        return EvaluatedHand {
            rank: HandRank::FourOfAKind,
            kickers: [quad_rank, kicker, 0, 0, 0],
        };
    }

    // Full house
    if trips.is_some() && !pairs.is_empty() {
        return EvaluatedHand {
            rank: HandRank::FullHouse,
            kickers: [trips.unwrap(), pairs[0], 0, 0, 0],
        };
    }

    // Flush
    if is_flush {
        return EvaluatedHand {
            rank: HandRank::Flush,
            kickers: [ranks[0], ranks[1], ranks[2], ranks[3], ranks[4]],
        };
    }

    // Straight
    if is_straight {
        return EvaluatedHand {
            rank: HandRank::Straight,
            kickers: [ranks[0], 0, 0, 0, 0],
        };
    }
    if is_wheel {
        return EvaluatedHand {
            rank: HandRank::Straight,
            kickers: [3, 0, 0, 0, 0], // 5-high
        };
    }

    // Three of a kind
    if let Some(trip_rank) = trips {
        return EvaluatedHand {
            rank: HandRank::ThreeOfAKind,
            kickers: [
                trip_rank,
                singles.first().copied().unwrap_or(0),
                singles.get(1).copied().unwrap_or(0),
                0,
                0,
            ],
        };
    }

    // Two pair
    if pairs.len() >= 2 {
        return EvaluatedHand {
            rank: HandRank::TwoPair,
            kickers: [
                pairs[0],
                pairs[1],
                singles.first().copied().unwrap_or(0),
                0,
                0,
            ],
        };
    }

    // One pair
    if pairs.len() == 1 {
        return EvaluatedHand {
            rank: HandRank::OnePair,
            kickers: [
                pairs[0],
                singles.first().copied().unwrap_or(0),
                singles.get(1).copied().unwrap_or(0),
                singles.get(2).copied().unwrap_or(0),
                0,
            ],
        };
    }

    // High card
    EvaluatedHand {
        rank: HandRank::HighCard,
        kickers: [ranks[0], ranks[1], ranks[2], ranks[3], ranks[4]],
    }
}

/// Check if sorted ranks (descending) form a straight
fn is_straight_ranks(ranks: &[u8; 5]) -> bool {
    for i in 0..4 {
        if ranks[i] != ranks[i + 1] + 1 {
            return false;
        }
    }
    true
}

/// Find winners from a list of players with their 7 cards
/// Returns indices of winning players (multiple = split pot)
pub fn find_winners(player_cards: &[(u8, [u8; 7])]) -> Vec<u8> {
    if player_cards.is_empty() {
        return vec![];
    }

    let mut best_eval: Option<EvaluatedHand> = None;
    let mut winners: Vec<u8> = vec![];

    for &(seat_index, cards) in player_cards {
        let eval = evaluate_hand(&cards);

        match &best_eval {
            None => {
                best_eval = Some(eval);
                winners = vec![seat_index];
            }
            Some(best) => {
                match eval.compare(best) {
                    std::cmp::Ordering::Greater => {
                        best_eval = Some(eval);
                        winners = vec![seat_index];
                    }
                    std::cmp::Ordering::Equal => {
                        winners.push(seat_index);
                    }
                    std::cmp::Ordering::Less => {}
                }
            }
        }
    }

    winners
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(rank: u8, suit: u8) -> u8 {
        suit * 13 + rank
    }

    #[test]
    fn test_royal_flush() {
        // A-K-Q-J-T of hearts + 2 random cards
        let cards = [
            card(12, 0), // Ah
            card(11, 0), // Kh
            card(10, 0), // Qh
            card(9, 0),  // Jh
            card(8, 0),  // Th
            card(0, 1),  // 2d
            card(1, 2),  // 3c
        ];
        let eval = evaluate_hand(&cards);
        assert_eq!(eval.rank, HandRank::RoyalFlush);
    }

    #[test]
    fn test_straight_flush() {
        // 9-8-7-6-5 of spades
        let cards = [
            card(7, 3),  // 9s
            card(6, 3),  // 8s
            card(5, 3),  // 7s
            card(4, 3),  // 6s
            card(3, 3),  // 5s
            card(0, 0),  // 2h
            card(1, 1),  // 3d
        ];
        let eval = evaluate_hand(&cards);
        assert_eq!(eval.rank, HandRank::StraightFlush);
        assert_eq!(eval.kickers[0], 7); // 9-high
    }

    #[test]
    fn test_four_of_a_kind() {
        let cards = [
            card(12, 0), // Ah
            card(12, 1), // Ad
            card(12, 2), // Ac
            card(12, 3), // As
            card(11, 0), // Kh
            card(0, 1),  // 2d
            card(1, 2),  // 3c
        ];
        let eval = evaluate_hand(&cards);
        assert_eq!(eval.rank, HandRank::FourOfAKind);
        assert_eq!(eval.kickers[0], 12); // Aces
        assert_eq!(eval.kickers[1], 11); // King kicker
    }

    #[test]
    fn test_full_house() {
        let cards = [
            card(11, 0), // Kh
            card(11, 1), // Kd
            card(11, 2), // Kc
            card(10, 0), // Qh
            card(10, 1), // Qd
            card(0, 2),  // 2c
            card(1, 3),  // 3s
        ];
        let eval = evaluate_hand(&cards);
        assert_eq!(eval.rank, HandRank::FullHouse);
        assert_eq!(eval.kickers[0], 11); // Kings
        assert_eq!(eval.kickers[1], 10); // Queens
    }

    #[test]
    fn test_flush() {
        let cards = [
            card(12, 0), // Ah
            card(10, 0), // Qh
            card(8, 0),  // Th
            card(6, 0),  // 8h
            card(2, 0),  // 4h
            card(0, 1),  // 2d
            card(1, 2),  // 3c
        ];
        let eval = evaluate_hand(&cards);
        assert_eq!(eval.rank, HandRank::Flush);
    }

    #[test]
    fn test_straight() {
        let cards = [
            card(8, 0),  // Th
            card(7, 1),  // 9d
            card(6, 2),  // 8c
            card(5, 3),  // 7s
            card(4, 0),  // 6h
            card(0, 1),  // 2d
            card(1, 2),  // 3c
        ];
        let eval = evaluate_hand(&cards);
        assert_eq!(eval.rank, HandRank::Straight);
        assert_eq!(eval.kickers[0], 8); // T-high
    }

    #[test]
    fn test_wheel_straight() {
        // A-2-3-4-5 (wheel)
        let cards = [
            card(12, 0), // Ah
            card(0, 1),  // 2d
            card(1, 2),  // 3c
            card(2, 3),  // 4s
            card(3, 0),  // 5h
            card(10, 1), // Qd
            card(11, 2), // Kc
        ];
        let eval = evaluate_hand(&cards);
        assert_eq!(eval.rank, HandRank::Straight);
        assert_eq!(eval.kickers[0], 3); // 5-high (wheel)
    }

    #[test]
    fn test_three_of_a_kind() {
        let cards = [
            card(9, 0),  // Jh
            card(9, 1),  // Jd
            card(9, 2),  // Jc
            card(12, 3), // As
            card(11, 0), // Kh
            card(0, 1),  // 2d
            card(1, 2),  // 3c
        ];
        let eval = evaluate_hand(&cards);
        assert_eq!(eval.rank, HandRank::ThreeOfAKind);
        assert_eq!(eval.kickers[0], 9); // Jacks
    }

    #[test]
    fn test_two_pair() {
        let cards = [
            card(12, 0), // Ah
            card(12, 1), // Ad
            card(11, 2), // Kc
            card(11, 3), // Ks
            card(10, 0), // Qh
            card(0, 1),  // 2d
            card(1, 2),  // 3c
        ];
        let eval = evaluate_hand(&cards);
        assert_eq!(eval.rank, HandRank::TwoPair);
        assert_eq!(eval.kickers[0], 12); // Aces
        assert_eq!(eval.kickers[1], 11); // Kings
        assert_eq!(eval.kickers[2], 10); // Queen kicker
    }

    #[test]
    fn test_one_pair() {
        let cards = [
            card(12, 0), // Ah
            card(12, 1), // Ad
            card(11, 2), // Kc
            card(10, 3), // Qs
            card(9, 0),  // Jh
            card(0, 1),  // 2d
            card(1, 2),  // 3c
        ];
        let eval = evaluate_hand(&cards);
        assert_eq!(eval.rank, HandRank::OnePair);
        assert_eq!(eval.kickers[0], 12); // Aces
    }

    #[test]
    fn test_high_card() {
        let cards = [
            card(12, 0), // Ah
            card(10, 1), // Qd
            card(8, 2),  // Tc
            card(6, 3),  // 8s
            card(4, 0),  // 6h
            card(2, 1),  // 4d
            card(0, 2),  // 2c
        ];
        let eval = evaluate_hand(&cards);
        assert_eq!(eval.rank, HandRank::HighCard);
        assert_eq!(eval.kickers[0], 12); // Ace high
    }

    #[test]
    fn test_find_winners_single() {
        // Player 0 has pair of Aces, Player 1 has pair of Kings
        // Community: 2h, 4d, 6c, 8s, Th (no straight possible)
        let player_cards = [
            (0, [
                card(12, 0), card(12, 1), // Ah Ad (pair of Aces)
                card(0, 0), card(2, 1), card(4, 2), card(6, 3), card(8, 0),
            ]),
            (1, [
                card(11, 0), card(11, 1), // Kh Kd (pair of Kings)
                card(0, 0), card(2, 1), card(4, 2), card(6, 3), card(8, 0),
            ]),
        ];
        let winners = find_winners(&player_cards);
        assert_eq!(winners, vec![0]); // Aces beats Kings
    }

    #[test]
    fn test_find_winners_split() {
        // Both players have same straight
        let player_cards = [
            (0, [
                card(8, 0), card(7, 1), // T9
                card(6, 2), card(5, 3), card(4, 0), card(0, 1), card(1, 2),
            ]),
            (1, [
                card(8, 2), card(7, 3), // T9 different suits
                card(6, 0), card(5, 1), card(4, 2), card(0, 3), card(1, 0),
            ]),
        ];
        let winners = find_winners(&player_cards);
        assert_eq!(winners.len(), 2);
    }

    // ==================== EDGE CASE TESTS ====================

    #[test]
    fn test_flush_kicker_comparison() {
        // Player 0: A-Q-9-7-5 flush
        // Player 1: A-Q-9-7-4 flush (loses on 5th kicker)
        let cards_0 = [
            card(12, 0), // Ah
            card(10, 0), // Qh
            card(7, 0),  // 9h
            card(5, 0),  // 7h
            card(3, 0),  // 5h
            card(0, 1),  // 2d (not used)
            card(1, 2),  // 3c (not used)
        ];
        let cards_1 = [
            card(12, 0), // Ah
            card(10, 0), // Qh
            card(7, 0),  // 9h
            card(5, 0),  // 7h
            card(2, 0),  // 4h (worse than 5h)
            card(0, 1),  // 2d
            card(1, 2),  // 3c
        ];
        let eval_0 = evaluate_hand(&cards_0);
        let eval_1 = evaluate_hand(&cards_1);
        assert_eq!(eval_0.rank, HandRank::Flush);
        assert_eq!(eval_1.rank, HandRank::Flush);
        assert_eq!(eval_0.compare(&eval_1), std::cmp::Ordering::Greater);
    }

    #[test]
    fn test_flush_same_kickers_split() {
        // Both have A-K-Q-J-9 flush (different suits, but flush only cares about ranks)
        // Community: A-K-Q-J-9 all hearts
        // Player 0: 2d 3c (uses community flush)
        // Player 1: 4d 5c (uses community flush)
        let cards_0 = [
            card(0, 1),  // 2d
            card(1, 2),  // 3c
            card(12, 0), // Ah
            card(11, 0), // Kh
            card(10, 0), // Qh
            card(9, 0),  // Jh
            card(7, 0),  // 9h
        ];
        let cards_1 = [
            card(2, 1),  // 4d
            card(3, 2),  // 5c
            card(12, 0), // Ah
            card(11, 0), // Kh
            card(10, 0), // Qh
            card(9, 0),  // Jh
            card(7, 0),  // 9h
        ];
        let player_cards = [(0, cards_0), (1, cards_1)];
        let winners = find_winners(&player_cards);
        assert_eq!(winners.len(), 2); // Split pot
    }

    #[test]
    fn test_full_house_comparison() {
        // Player 0: KKK-QQ (Kings full of Queens)
        // Player 1: QQQ-KK (Queens full of Kings)
        // Kings full beats Queens full
        let cards_0 = [
            card(11, 0), // Kh
            card(11, 1), // Kd
            card(11, 2), // Kc
            card(10, 0), // Qh
            card(10, 1), // Qd
            card(0, 2),  // 2c
            card(1, 3),  // 3s
        ];
        let cards_1 = [
            card(10, 0), // Qh
            card(10, 1), // Qd
            card(10, 2), // Qc
            card(11, 0), // Kh
            card(11, 1), // Kd
            card(0, 2),  // 2c
            card(1, 3),  // 3s
        ];
        let eval_0 = evaluate_hand(&cards_0);
        let eval_1 = evaluate_hand(&cards_1);
        assert_eq!(eval_0.rank, HandRank::FullHouse);
        assert_eq!(eval_1.rank, HandRank::FullHouse);
        assert_eq!(eval_0.compare(&eval_1), std::cmp::Ordering::Greater);
    }

    #[test]
    fn test_two_pair_kicker() {
        // Player 0: AA-KK-Q kicker
        // Player 1: AA-KK-J kicker
        // Same two pair, but Q kicker beats J kicker
        let cards_0 = [
            card(12, 0), // Ah
            card(12, 1), // Ad
            card(11, 2), // Kc
            card(11, 3), // Ks
            card(10, 0), // Qh (kicker)
            card(0, 1),  // 2d
            card(1, 2),  // 3c
        ];
        let cards_1 = [
            card(12, 2), // Ac
            card(12, 3), // As
            card(11, 0), // Kh
            card(11, 1), // Kd
            card(9, 0),  // Jh (worse kicker)
            card(0, 2),  // 2c
            card(1, 3),  // 3s
        ];
        let eval_0 = evaluate_hand(&cards_0);
        let eval_1 = evaluate_hand(&cards_1);
        assert_eq!(eval_0.rank, HandRank::TwoPair);
        assert_eq!(eval_1.rank, HandRank::TwoPair);
        assert_eq!(eval_0.compare(&eval_1), std::cmp::Ordering::Greater);
    }

    #[test]
    fn test_two_pair_second_pair_matters() {
        // Player 0: AA-QQ
        // Player 1: AA-JJ
        // Same high pair (Aces), but Queens beats Jacks
        let cards_0 = [
            card(12, 0), // Ah
            card(12, 1), // Ad
            card(10, 2), // Qc
            card(10, 3), // Qs
            card(5, 0),  // 7h
            card(0, 1),  // 2d
            card(1, 2),  // 3c
        ];
        let cards_1 = [
            card(12, 2), // Ac
            card(12, 3), // As
            card(9, 0),  // Jh
            card(9, 1),  // Jd
            card(5, 2),  // 7c
            card(0, 2),  // 2c
            card(1, 3),  // 3s
        ];
        let eval_0 = evaluate_hand(&cards_0);
        let eval_1 = evaluate_hand(&cards_1);
        assert_eq!(eval_0.rank, HandRank::TwoPair);
        assert_eq!(eval_1.rank, HandRank::TwoPair);
        assert_eq!(eval_0.compare(&eval_1), std::cmp::Ordering::Greater);
    }

    #[test]
    fn test_one_pair_kicker_chain() {
        // Player 0: AA-K-Q-J
        // Player 1: AA-K-Q-T
        // Same pair, same first two kickers, third kicker decides
        let cards_0 = [
            card(12, 0), // Ah
            card(12, 1), // Ad
            card(11, 2), // Kc
            card(10, 3), // Qs
            card(9, 0),  // Jh
            card(0, 1),  // 2d
            card(1, 2),  // 3c
        ];
        let cards_1 = [
            card(12, 2), // Ac
            card(12, 3), // As
            card(11, 0), // Kh
            card(10, 1), // Qd
            card(8, 0),  // Th (worse than J)
            card(0, 2),  // 2c
            card(1, 3),  // 3s
        ];
        let eval_0 = evaluate_hand(&cards_0);
        let eval_1 = evaluate_hand(&cards_1);
        assert_eq!(eval_0.rank, HandRank::OnePair);
        assert_eq!(eval_1.rank, HandRank::OnePair);
        assert_eq!(eval_0.compare(&eval_1), std::cmp::Ordering::Greater);
    }

    #[test]
    fn test_trips_kicker() {
        // Player 0: KKK-A-Q
        // Player 1: KKK-A-J
        // Same trips, same first kicker, second kicker decides
        let cards_0 = [
            card(11, 0), // Kh
            card(11, 1), // Kd
            card(11, 2), // Kc
            card(12, 3), // As
            card(10, 0), // Qh
            card(0, 1),  // 2d
            card(1, 2),  // 3c
        ];
        let cards_1 = [
            card(11, 0), // Kh
            card(11, 1), // Kd
            card(11, 3), // Ks
            card(12, 2), // Ac
            card(9, 0),  // Jh (worse kicker)
            card(0, 2),  // 2c
            card(1, 3),  // 3s
        ];
        let eval_0 = evaluate_hand(&cards_0);
        let eval_1 = evaluate_hand(&cards_1);
        assert_eq!(eval_0.rank, HandRank::ThreeOfAKind);
        assert_eq!(eval_1.rank, HandRank::ThreeOfAKind);
        assert_eq!(eval_0.compare(&eval_1), std::cmp::Ordering::Greater);
    }

    #[test]
    fn test_high_card_all_kickers() {
        // Player 0: A-K-Q-J-9
        // Player 1: A-K-Q-J-8
        // All high cards, 5th card decides
        let cards_0 = [
            card(12, 0), // Ah
            card(11, 1), // Kd
            card(10, 2), // Qc
            card(9, 3),  // Js
            card(7, 0),  // 9h
            card(0, 1),  // 2d
            card(1, 2),  // 3c
        ];
        let cards_1 = [
            card(12, 1), // Ad
            card(11, 2), // Kc
            card(10, 3), // Qs
            card(9, 0),  // Jh
            card(6, 1),  // 8d (worse)
            card(0, 2),  // 2c
            card(1, 3),  // 3s
        ];
        let eval_0 = evaluate_hand(&cards_0);
        let eval_1 = evaluate_hand(&cards_1);
        assert_eq!(eval_0.rank, HandRank::HighCard);
        assert_eq!(eval_1.rank, HandRank::HighCard);
        assert_eq!(eval_0.compare(&eval_1), std::cmp::Ordering::Greater);
    }

    #[test]
    fn test_straight_flush_beats_quads() {
        // Player 0: 6-high straight flush
        // Player 1: Four Aces
        // Straight flush beats four of a kind
        let cards_0 = [
            card(4, 0),  // 6h
            card(3, 0),  // 5h
            card(2, 0),  // 4h
            card(1, 0),  // 3h
            card(0, 0),  // 2h
            card(12, 1), // Ad
            card(11, 2), // Kc
        ];
        let cards_1 = [
            card(12, 0), // Ah
            card(12, 1), // Ad
            card(12, 2), // Ac
            card(12, 3), // As
            card(11, 0), // Kh
            card(10, 1), // Qd
            card(9, 2),  // Jc
        ];
        let eval_0 = evaluate_hand(&cards_0);
        let eval_1 = evaluate_hand(&cards_1);
        assert_eq!(eval_0.rank, HandRank::StraightFlush);
        assert_eq!(eval_1.rank, HandRank::FourOfAKind);
        assert_eq!(eval_0.compare(&eval_1), std::cmp::Ordering::Greater);
    }

    #[test]
    fn test_quads_kicker() {
        // Player 0: AAAA-K
        // Player 1: AAAA-Q
        // Same quads, kicker decides
        let cards_0 = [
            card(12, 0), // Ah
            card(12, 1), // Ad
            card(12, 2), // Ac
            card(12, 3), // As
            card(11, 0), // Kh
            card(0, 1),  // 2d
            card(1, 2),  // 3c
        ];
        let cards_1 = [
            card(12, 0), // Ah
            card(12, 1), // Ad
            card(12, 2), // Ac
            card(12, 3), // As
            card(10, 0), // Qh (worse kicker)
            card(0, 1),  // 2d
            card(1, 2),  // 3c
        ];
        let eval_0 = evaluate_hand(&cards_0);
        let eval_1 = evaluate_hand(&cards_1);
        assert_eq!(eval_0.rank, HandRank::FourOfAKind);
        assert_eq!(eval_1.rank, HandRank::FourOfAKind);
        assert_eq!(eval_0.compare(&eval_1), std::cmp::Ordering::Greater);
    }

    #[test]
    fn test_straight_flush_vs_straight_flush() {
        // Player 0: 9-high straight flush
        // Player 1: 8-high straight flush
        let cards_0 = [
            card(7, 0),  // 9h
            card(6, 0),  // 8h
            card(5, 0),  // 7h
            card(4, 0),  // 6h
            card(3, 0),  // 5h
            card(0, 1),  // 2d
            card(1, 2),  // 3c
        ];
        let cards_1 = [
            card(6, 1),  // 8d
            card(5, 1),  // 7d
            card(4, 1),  // 6d
            card(3, 1),  // 5d
            card(2, 1),  // 4d
            card(0, 2),  // 2c
            card(1, 3),  // 3s
        ];
        let eval_0 = evaluate_hand(&cards_0);
        let eval_1 = evaluate_hand(&cards_1);
        assert_eq!(eval_0.rank, HandRank::StraightFlush);
        assert_eq!(eval_1.rank, HandRank::StraightFlush);
        assert_eq!(eval_0.compare(&eval_1), std::cmp::Ordering::Greater);
    }

    #[test]
    fn test_board_plays_split() {
        // Community: A-K-Q-J-T (broadway straight)
        // Both players have lower cards - board plays
        let cards_0 = [
            card(0, 0),  // 2h
            card(1, 1),  // 3d
            card(12, 2), // Ac
            card(11, 3), // Ks
            card(10, 0), // Qh
            card(9, 1),  // Jd
            card(8, 2),  // Tc
        ];
        let cards_1 = [
            card(2, 0),  // 4h
            card(3, 1),  // 5d
            card(12, 2), // Ac
            card(11, 3), // Ks
            card(10, 0), // Qh
            card(9, 1),  // Jd
            card(8, 2),  // Tc
        ];
        let player_cards = [(0, cards_0), (1, cards_1)];
        let winners = find_winners(&player_cards);
        assert_eq!(winners.len(), 2); // Both play the board - split
    }

    // ==================== FUZZ TESTS AGAINST REFERENCE IMPLEMENTATION ====================

    use rand::seq::SliceRandom;
    use rand::SeedableRng;
    use rand::rngs::StdRng;
    use aya_poker::base::{Card as AyaCard, Hand as AyaHand, Rank as AyaRank, Suit as AyaSuit};
    use aya_poker::poker_rank;

    /// Convert our card encoding (0-51) to aya_poker Card
    fn to_aya_card(card: u8) -> AyaCard {
        let rank = card % 13; // 0=2, 1=3, ..., 12=A
        let suit = card / 13; // 0=Hearts, 1=Diamonds, 2=Clubs, 3=Spades

        let aya_rank = match rank {
            0 => AyaRank::Two,
            1 => AyaRank::Three,
            2 => AyaRank::Four,
            3 => AyaRank::Five,
            4 => AyaRank::Six,
            5 => AyaRank::Seven,
            6 => AyaRank::Eight,
            7 => AyaRank::Nine,
            8 => AyaRank::Ten,
            9 => AyaRank::Jack,
            10 => AyaRank::Queen,
            11 => AyaRank::King,
            12 => AyaRank::Ace,
            _ => panic!("Invalid rank"),
        };

        let aya_suit = match suit {
            0 => AyaSuit::Hearts,
            1 => AyaSuit::Diamonds,
            2 => AyaSuit::Clubs,
            3 => AyaSuit::Spades,
            _ => panic!("Invalid suit"),
        };

        AyaCard::new(aya_rank, aya_suit)
    }

    /// Generate two random hands sharing community cards (like Texas Hold'em)
    fn generate_two_hands(rng: &mut StdRng) -> ([u8; 7], [u8; 7]) {
        let mut deck: Vec<u8> = (0..52).collect();
        deck.shuffle(rng);
        // Community cards (5) + Player 1 hole (2) + Player 2 hole (2) = 9 unique cards
        let community: [u8; 5] = [deck[0], deck[1], deck[2], deck[3], deck[4]];
        let p1_hole: [u8; 2] = [deck[5], deck[6]];
        let p2_hole: [u8; 2] = [deck[7], deck[8]];

        let hand1 = [p1_hole[0], p1_hole[1], community[0], community[1], community[2], community[3], community[4]];
        let hand2 = [p2_hole[0], p2_hole[1], community[0], community[1], community[2], community[3], community[4]];

        (hand1, hand2)
    }

    /// Convert cards to aya_poker Hand
    fn to_aya_hand(cards: &[u8; 7]) -> AyaHand {
        cards.iter().map(|&c| to_aya_card(c)).collect()
    }

    #[test]
    fn fuzz_test_winner_determination_50k_matchups() {
        // Use seeded RNG for reproducibility
        let mut rng = StdRng::seed_from_u64(12345);
        let iterations = 50_000;
        let mut player1_wins = 0;
        let mut player2_wins = 0;
        let mut ties = 0;

        for i in 0..iterations {
            let (hand1, hand2) = generate_two_hands(&mut rng);

            // Our implementation
            let our_eval1 = evaluate_hand(&hand1);
            let our_eval2 = evaluate_hand(&hand2);
            let our_comparison = our_eval1.compare(&our_eval2);

            // aya_poker implementation
            let aya_hand1 = to_aya_hand(&hand1);
            let aya_hand2 = to_aya_hand(&hand2);
            let aya_rank1 = poker_rank(&aya_hand1);
            let aya_rank2 = poker_rank(&aya_hand2);
            let aya_comparison = aya_rank1.cmp(&aya_rank2);

            assert_eq!(
                our_comparison, aya_comparison,
                "Winner mismatch at iteration {}:\n  hand1={:?} (our={:?})\n  hand2={:?} (our={:?})\n  our_cmp={:?}, aya_cmp={:?}",
                i, hand1, our_eval1.rank, hand2, our_eval2.rank, our_comparison, aya_comparison
            );

            match our_comparison {
                std::cmp::Ordering::Greater => player1_wins += 1,
                std::cmp::Ordering::Less => player2_wins += 1,
                std::cmp::Ordering::Equal => ties += 1,
            }
        }

        println!("✅ Passed {} winner determination tests", iterations);
        println!("   Player 1 wins: {}, Player 2 wins: {}, Ties: {}", player1_wins, player2_wins, ties);
    }

    #[test]
    fn fuzz_test_three_player_showdown_10k() {
        // Test with 3 players to catch edge cases in multi-way pots
        let mut rng = StdRng::seed_from_u64(99999);
        let iterations = 10_000;

        for i in 0..iterations {
            let mut deck: Vec<u8> = (0..52).collect();
            deck.shuffle(&mut rng);

            // Community + 3 players = 5 + 6 = 11 cards
            let community: [u8; 5] = [deck[0], deck[1], deck[2], deck[3], deck[4]];
            let p1 = [deck[5], deck[6], community[0], community[1], community[2], community[3], community[4]];
            let p2 = [deck[7], deck[8], community[0], community[1], community[2], community[3], community[4]];
            let p3 = [deck[9], deck[10], community[0], community[1], community[2], community[3], community[4]];

            // Our implementation
            let player_cards = [(0u8, p1), (1u8, p2), (2u8, p3)];
            let our_winners = find_winners(&player_cards);

            // aya_poker implementation - find winners manually
            let aya_rank1 = poker_rank(&to_aya_hand(&p1));
            let aya_rank2 = poker_rank(&to_aya_hand(&p2));
            let aya_rank3 = poker_rank(&to_aya_hand(&p3));

            let max_rank = aya_rank1.max(aya_rank2).max(aya_rank3);
            let mut aya_winners: Vec<u8> = Vec::new();
            if aya_rank1 == max_rank { aya_winners.push(0); }
            if aya_rank2 == max_rank { aya_winners.push(1); }
            if aya_rank3 == max_rank { aya_winners.push(2); }

            assert_eq!(
                our_winners, aya_winners,
                "3-player winner mismatch at iteration {}:\n  p1={:?}\n  p2={:?}\n  p3={:?}\n  our_winners={:?}, aya_winners={:?}",
                i, p1, p2, p3, our_winners, aya_winners
            );
        }

        println!("✅ Passed {} three-player showdown tests", iterations);
    }

    #[test]
    fn test_all_hand_types_against_reference() {
        // Test specific hands of each type to ensure correct classification
        let test_cases: Vec<([u8; 7], HandRank, &str)> = vec![
            // Royal Flush: A-K-Q-J-T of hearts
            ([card(12,0), card(11,0), card(10,0), card(9,0), card(8,0), card(0,1), card(1,2)],
             HandRank::RoyalFlush, "Royal Flush"),

            // Straight Flush: 9-8-7-6-5 of spades
            ([card(7,3), card(6,3), card(5,3), card(4,3), card(3,3), card(0,0), card(1,1)],
             HandRank::StraightFlush, "Straight Flush"),

            // Steel Wheel (A-2-3-4-5 suited)
            ([card(12,0), card(0,0), card(1,0), card(2,0), card(3,0), card(10,1), card(11,2)],
             HandRank::StraightFlush, "Steel Wheel (A-5 straight flush)"),

            // Four of a Kind
            ([card(12,0), card(12,1), card(12,2), card(12,3), card(11,0), card(0,1), card(1,2)],
             HandRank::FourOfAKind, "Four of a Kind"),

            // Full House
            ([card(11,0), card(11,1), card(11,2), card(10,0), card(10,1), card(0,2), card(1,3)],
             HandRank::FullHouse, "Full House"),

            // Flush
            ([card(12,0), card(10,0), card(8,0), card(6,0), card(2,0), card(0,1), card(1,2)],
             HandRank::Flush, "Flush"),

            // Straight
            ([card(8,0), card(7,1), card(6,2), card(5,3), card(4,0), card(0,1), card(1,2)],
             HandRank::Straight, "Straight"),

            // Wheel (A-2-3-4-5)
            ([card(12,0), card(0,1), card(1,2), card(2,3), card(3,0), card(10,1), card(11,2)],
             HandRank::Straight, "Wheel (A-5 straight)"),

            // Three of a Kind
            ([card(9,0), card(9,1), card(9,2), card(12,3), card(11,0), card(0,1), card(1,2)],
             HandRank::ThreeOfAKind, "Three of a Kind"),

            // Two Pair
            ([card(12,0), card(12,1), card(11,2), card(11,3), card(10,0), card(0,1), card(1,2)],
             HandRank::TwoPair, "Two Pair"),

            // One Pair
            ([card(12,0), card(12,1), card(11,2), card(10,3), card(9,0), card(0,1), card(1,2)],
             HandRank::OnePair, "One Pair"),

            // High Card
            ([card(12,0), card(10,1), card(8,2), card(6,3), card(4,0), card(2,1), card(0,2)],
             HandRank::HighCard, "High Card"),
        ];

        for (cards, expected_rank, description) in test_cases {
            let our_eval = evaluate_hand(&cards);

            assert_eq!(
                our_eval.rank, expected_rank,
                "{}: expected {:?}, got {:?}", description, expected_rank, our_eval.rank
            );

            // Verify against aya_poker (they should agree on winners when compared)
            println!("✓ {}: {:?}", description, our_eval.rank);
        }

        println!("✅ All hand types correctly classified");
    }

    #[test]
    fn test_edge_cases_comprehensive() {
        // Test tricky edge cases that could trip up hand evaluation

        // Case 1: Board has a straight, but player can make a flush
        // Case 1: Board has a straight possibility, but player can make a flush
        let board_straight_player_flush_fixed = [
            card(12, 0), // Ah
            card(10, 0), // Qh
            card(8, 0),  // Th
            card(5, 0),  // 7h
            card(2, 0),  // 4h - 5 hearts = flush
            card(7, 1),  // 9d
            card(6, 2),  // 8c
        ];
        let eval = evaluate_hand(&board_straight_player_flush_fixed);
        assert_eq!(eval.rank, HandRank::Flush, "Should detect flush over straight");

        // Case 2: Two players with same two pair, different kicker
        let two_pair_high_kicker = [
            card(12, 0), card(12, 1), // AA
            card(11, 2), card(11, 3), // KK
            card(10, 0), // Q kicker
            card(0, 1), card(1, 2),
        ];
        let two_pair_low_kicker = [
            card(12, 2), card(12, 3), // AA
            card(11, 0), card(11, 1), // KK
            card(9, 0), // J kicker (lower)
            card(0, 2), card(1, 3),
        ];
        let eval1 = evaluate_hand(&two_pair_high_kicker);
        let eval2 = evaluate_hand(&two_pair_low_kicker);
        assert_eq!(eval1.compare(&eval2), std::cmp::Ordering::Greater, "Q kicker should beat J kicker");

        // Case 3: Counterfeited two pair (board pairs beat player's pair)
        // Player has 77, board has AAKK - player's best hand is AAKK7
        let counterfeited = [
            card(5, 0), card(5, 1), // 77 (player's pair)
            card(12, 2), card(12, 3), // AA on board
            card(11, 0), card(11, 1), // KK on board
            card(0, 2), // 2c
        ];
        let eval = evaluate_hand(&counterfeited);
        assert_eq!(eval.rank, HandRank::TwoPair, "Should be two pair (AA-KK)");
        assert_eq!(eval.kickers[0], 12, "High pair should be Aces");
        assert_eq!(eval.kickers[1], 11, "Low pair should be Kings");

        // Case 4: Full house with trips on board
        // Board: KKK, Player: QQ - makes KKK-QQ full house
        let trips_on_board = [
            card(10, 0), card(10, 1), // QQ (player)
            card(11, 2), card(11, 3), card(11, 0), // KKK (board)
            card(0, 1), card(1, 2), // junk
        ];
        let eval = evaluate_hand(&trips_on_board);
        assert_eq!(eval.rank, HandRank::FullHouse);
        assert_eq!(eval.kickers[0], 11, "Trips should be Kings");
        assert_eq!(eval.kickers[1], 10, "Pair should be Queens");

        // Case 5: Flush with 6 suited cards - should pick best 5
        let six_suited = [
            card(12, 0), // Ah
            card(11, 0), // Kh
            card(10, 0), // Qh
            card(8, 0),  // Th
            card(6, 0),  // 8h
            card(2, 0),  // 4h - 6 hearts total
            card(0, 1),  // 2d
        ];
        let eval = evaluate_hand(&six_suited);
        assert_eq!(eval.rank, HandRank::Flush);
        assert_eq!(eval.kickers[0], 12, "Highest flush card should be Ace");
        assert_eq!(eval.kickers[4], 6, "5th flush card should be 8, not 4");

        println!("✅ All edge cases passed");
    }
}

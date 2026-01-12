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
}

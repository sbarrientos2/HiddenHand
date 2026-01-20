//! Program events for on-chain audit trail
//!
//! Events are emitted to transaction logs and can be indexed
//! for displaying hand history to players.

use anchor_lang::prelude::*;

/// Emitted when a hand completes (showdown or everyone folds)
/// Contains all information needed to reconstruct and verify the hand
#[event]
pub struct HandCompleted {
    /// Table identifier
    pub table_id: [u8; 32],

    /// Sequential hand number
    pub hand_number: u64,

    /// Unix timestamp when hand completed
    pub timestamp: i64,

    /// Community cards (5 cards, 255 = not dealt)
    pub community_cards: [u8; 5],

    /// Total pot that was distributed
    pub total_pot: u64,

    /// Number of players who participated
    pub player_count: u8,

    /// Results for each player (up to 6)
    /// Using fixed array because Vec has variable size issues with events
    pub results: [PlayerHandResult; 6],

    /// How many results are valid (rest are zeroed)
    pub results_count: u8,
}

/// Individual player's result in a hand
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct PlayerHandResult {
    /// Player's wallet pubkey
    pub player: Pubkey,

    /// Seat index (0-5)
    pub seat_index: u8,

    /// Hole cards (255 = not shown / folded)
    pub hole_card_1: u8,
    pub hole_card_2: u8,

    /// Hand rank (0=HighCard, 1=Pair, ..., 9=RoyalFlush, 255=folded/not evaluated)
    pub hand_rank: u8,

    /// Chips won this hand (0 if lost)
    pub chips_won: u64,

    /// Total bet this hand (chips put into pot)
    pub chips_bet: u64,

    /// Whether player folded
    pub folded: bool,

    /// Whether player was all-in
    pub all_in: bool,
}

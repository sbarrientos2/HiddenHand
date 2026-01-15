use anchor_lang::prelude::*;

use crate::constants::DECK_SIZE;

/// Encrypted deck state for a hand
/// Cards are stored as Inco encrypted handles
#[account]
pub struct DeckState {
    /// Reference to hand
    pub hand: Pubkey,

    /// Shuffled encrypted cards (Inco handles)
    /// Each u128 is a handle to an encrypted card value (0-51)
    /// NOTE: Cards are shuffled on ER after delegation, not on base layer
    pub cards: [u128; DECK_SIZE],

    /// Next card index to deal
    pub deal_index: u8,

    /// Whether deck has been shuffled (shuffle happens on ER, not base layer)
    pub is_shuffled: bool,

    /// VRF seed received from callback (stored on base layer)
    /// The actual shuffle uses this seed but happens on ER after delegation
    /// This ensures the shuffle order is never visible on base layer
    pub vrf_seed: [u8; 32],

    /// Whether VRF seed has been received
    pub seed_received: bool,

    /// PDA bump
    pub bump: u8,
}

impl DeckState {
    pub const SIZE: usize = 8 + // discriminator
        32 + // hand
        (16 * DECK_SIZE) + // cards array (52 * 16 bytes)
        1 +  // deal_index
        1 +  // is_shuffled
        32 + // vrf_seed
        1 +  // seed_received
        1;   // bump

    /// Deal next card, returns the encrypted handle
    pub fn deal_card(&mut self) -> Option<u128> {
        if (self.deal_index as usize) < DECK_SIZE {
            let card = self.cards[self.deal_index as usize];
            self.deal_index += 1;
            Some(card)
        } else {
            None
        }
    }

    /// Get number of cards dealt
    pub fn cards_dealt(&self) -> u8 {
        self.deal_index
    }

    /// Get number of cards remaining
    pub fn cards_remaining(&self) -> u8 {
        (DECK_SIZE as u8).saturating_sub(self.deal_index)
    }
}

/// Helper functions for card encoding
/// Card value: 0-51
/// Suit: value / 13 (0=Hearts, 1=Diamonds, 2=Clubs, 3=Spades)
/// Rank: value % 13 (0=2, 1=3, ..., 8=10, 9=J, 10=Q, 11=K, 12=A)
pub mod card_utils {
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum Suit {
        Hearts = 0,
        Diamonds = 1,
        Clubs = 2,
        Spades = 3,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum Rank {
        Two = 0,
        Three = 1,
        Four = 2,
        Five = 3,
        Six = 4,
        Seven = 5,
        Eight = 6,
        Nine = 7,
        Ten = 8,
        Jack = 9,
        Queen = 10,
        King = 11,
        Ace = 12,
    }

    pub fn card_to_suit(card: u8) -> Suit {
        match card / 13 {
            0 => Suit::Hearts,
            1 => Suit::Diamonds,
            2 => Suit::Clubs,
            _ => Suit::Spades,
        }
    }

    pub fn card_to_rank(card: u8) -> Rank {
        match card % 13 {
            0 => Rank::Two,
            1 => Rank::Three,
            2 => Rank::Four,
            3 => Rank::Five,
            4 => Rank::Six,
            5 => Rank::Seven,
            6 => Rank::Eight,
            7 => Rank::Nine,
            8 => Rank::Ten,
            9 => Rank::Jack,
            10 => Rank::Queen,
            11 => Rank::King,
            _ => Rank::Ace,
        }
    }

    pub fn encode_card(suit: Suit, rank: Rank) -> u8 {
        (suit as u8) * 13 + (rank as u8)
    }

    /// Display card as string (for debugging/UI)
    pub fn card_to_string(card: u8) -> String {
        let rank = match card % 13 {
            0 => "2",
            1 => "3",
            2 => "4",
            3 => "5",
            4 => "6",
            5 => "7",
            6 => "8",
            7 => "9",
            8 => "T",
            9 => "J",
            10 => "Q",
            11 => "K",
            12 => "A",
            _ => "?",
        };
        let suit = match card / 13 {
            0 => "h", // hearts
            1 => "d", // diamonds
            2 => "c", // clubs
            3 => "s", // spades
            _ => "?",
        };
        format!("{}{}", rank, suit)
    }
}

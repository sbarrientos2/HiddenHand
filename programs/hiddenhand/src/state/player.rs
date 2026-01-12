use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum PlayerStatus {
    /// Seated but not in current hand
    Sitting,
    /// Active in current hand
    Playing,
    /// Folded this hand
    Folded,
    /// All-in this hand
    AllIn,
}

impl Default for PlayerStatus {
    fn default() -> Self {
        PlayerStatus::Sitting
    }
}

#[account]
#[derive(InitSpace)]
pub struct PlayerSeat {
    /// Reference to table
    pub table: Pubkey,

    /// Player's wallet
    pub player: Pubkey,

    /// Seat index (0 to max_players-1)
    pub seat_index: u8,

    /// Player's chip stack at this table
    pub chips: u64,

    /// Amount bet in current betting round
    pub current_bet: u64,

    /// Total amount invested in current hand
    pub total_bet_this_hand: u64,

    /// Encrypted hole card 1 (Inco handle)
    pub hole_card_1: u128,

    /// Encrypted hole card 2 (Inco handle)
    pub hole_card_2: u128,

    /// Current status
    pub status: PlayerStatus,

    /// Has acted in current betting round
    pub has_acted: bool,

    /// PDA bump
    pub bump: u8,
}

impl PlayerSeat {
    pub const SIZE: usize = 8 + // discriminator
        32 + // table
        32 + // player
        1 +  // seat_index
        8 +  // chips
        8 +  // current_bet
        8 +  // total_bet_this_hand
        16 + // hole_card_1
        16 + // hole_card_2
        1 +  // status
        1 +  // has_acted
        1;   // bump

    /// Reset for new hand
    pub fn reset_for_new_hand(&mut self) {
        self.current_bet = 0;
        self.total_bet_this_hand = 0;
        self.hole_card_1 = 0;
        self.hole_card_2 = 0;
        self.status = PlayerStatus::Playing;
        self.has_acted = false;
    }

    /// Reset for new betting round
    pub fn reset_for_betting_round(&mut self) {
        self.current_bet = 0;
        self.has_acted = false;
    }

    /// Place a bet (returns actual amount bet, handles all-in)
    pub fn place_bet(&mut self, amount: u64) -> u64 {
        let actual_bet = amount.min(self.chips);
        self.chips = self.chips.saturating_sub(actual_bet);
        self.current_bet = self.current_bet.saturating_add(actual_bet);
        self.total_bet_this_hand = self.total_bet_this_hand.saturating_add(actual_bet);

        if self.chips == 0 {
            self.status = PlayerStatus::AllIn;
        }

        actual_bet
    }

    /// Award chips (from winning pot)
    pub fn award_chips(&mut self, amount: u64) {
        self.chips = self.chips.saturating_add(amount);
    }

    /// Check if player can act (not folded or all-in)
    pub fn can_act(&self) -> bool {
        matches!(self.status, PlayerStatus::Playing)
    }

    /// Fold the hand
    pub fn fold(&mut self) {
        self.status = PlayerStatus::Folded;
    }
}

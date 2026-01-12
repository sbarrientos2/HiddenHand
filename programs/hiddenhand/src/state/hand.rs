use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum GamePhase {
    /// Cards being dealt
    Dealing,
    /// Pre-flop betting (after hole cards)
    PreFlop,
    /// Flop betting (3 community cards)
    Flop,
    /// Turn betting (4th community card)
    Turn,
    /// River betting (5th community card)
    River,
    /// Showdown - reveal hands
    Showdown,
    /// Hand complete, pot distributed
    Settled,
}

impl Default for GamePhase {
    fn default() -> Self {
        GamePhase::Dealing
    }
}

#[account]
#[derive(InitSpace)]
pub struct HandState {
    /// Reference to parent table
    pub table: Pubkey,

    /// Hand number (matches table.hand_number when created)
    pub hand_number: u64,

    /// Current phase of the hand
    pub phase: GamePhase,

    /// Total pot in lamports
    pub pot: u64,

    /// Current bet to call
    pub current_bet: u64,

    /// Minimum raise amount
    pub min_raise: u64,

    /// Dealer position for this hand
    pub dealer_position: u8,

    /// Seat index of player whose turn it is
    pub action_on: u8,

    /// Community cards (card indices 0-51, 255 = not revealed)
    #[max_len(5)]
    pub community_cards: Vec<u8>,

    /// Number of community cards revealed (0, 3, 4, or 5)
    pub community_revealed: u8,

    /// Bitmap of players still active in hand
    pub active_players: u8,

    /// Bitmap of players who have acted this round
    pub acted_this_round: u8,

    /// Number of active players
    pub active_count: u8,

    /// Bitmap of players who are all-in
    pub all_in_players: u8,

    /// Last action slot for timeout tracking
    pub last_action_slot: u64,

    /// Slot when hand started
    pub hand_start_slot: u64,

    /// PDA bump
    pub bump: u8,
}

impl HandState {
    pub const SIZE: usize = 8 + // discriminator
        32 + // table
        8 +  // hand_number
        1 +  // phase
        8 +  // pot
        8 +  // current_bet
        8 +  // min_raise
        1 +  // dealer_position
        1 +  // action_on
        4 + 5 + // community_cards vec (4 byte length + 5 bytes)
        1 +  // community_revealed
        1 +  // active_players
        1 +  // acted_this_round
        1 +  // active_count
        1 +  // all_in_players
        8 +  // last_action_slot
        8 +  // hand_start_slot
        1;   // bump

    /// Check if player is still active in hand
    pub fn is_player_active(&self, seat_index: u8) -> bool {
        self.active_players & (1 << seat_index) != 0
    }

    /// Mark player as folded
    pub fn fold_player(&mut self, seat_index: u8) {
        self.active_players &= !(1 << seat_index);
        self.active_count = self.active_count.saturating_sub(1);
    }

    /// Check if player has acted this betting round
    pub fn has_player_acted(&self, seat_index: u8) -> bool {
        self.acted_this_round & (1 << seat_index) != 0
    }

    /// Mark player as having acted
    pub fn mark_acted(&mut self, seat_index: u8) {
        self.acted_this_round |= 1 << seat_index;
    }

    /// Reset acted flags for new betting round
    pub fn reset_betting_round(&mut self) {
        self.acted_this_round = 0;
        self.current_bet = 0;
    }

    /// Mark player as all-in
    pub fn mark_all_in(&mut self, seat_index: u8) {
        self.all_in_players |= 1 << seat_index;
    }

    /// Check if player is all-in
    pub fn is_player_all_in(&self, seat_index: u8) -> bool {
        self.all_in_players & (1 << seat_index) != 0
    }

    /// Get players who can still bet (active but not all-in)
    pub fn players_who_can_bet(&self) -> u8 {
        self.active_players & !self.all_in_players
    }

    /// Check if any player can still make a betting action
    pub fn can_anyone_bet(&self) -> bool {
        // At least 2 players need to be able to bet for betting to continue
        // If only 1 or 0 players can bet, no more betting is possible
        let can_bet = self.players_who_can_bet();
        can_bet.count_ones() >= 2
    }

    /// Check if betting round is complete
    pub fn is_betting_complete(&self) -> bool {
        // Players who can bet and haven't acted yet
        let can_bet = self.players_who_can_bet();
        let need_to_act = can_bet & !self.acted_this_round;

        // Betting is complete if all players who can bet have acted
        need_to_act == 0
    }

    /// Find next active player after given seat
    pub fn next_active_player(&self, after_seat: u8, max_players: u8) -> Option<u8> {
        let mut next = (after_seat + 1) % max_players;
        for _ in 0..max_players {
            if self.is_player_active(next) {
                return Some(next);
            }
            next = (next + 1) % max_players;
        }
        None
    }

    /// Advance to next phase
    pub fn advance_phase(&mut self) {
        self.phase = match self.phase {
            GamePhase::Dealing => GamePhase::PreFlop,
            GamePhase::PreFlop => GamePhase::Flop,
            GamePhase::Flop => GamePhase::Turn,
            GamePhase::Turn => GamePhase::River,
            GamePhase::River => GamePhase::Showdown,
            GamePhase::Showdown => GamePhase::Settled,
            GamePhase::Settled => GamePhase::Settled,
        };
        self.reset_betting_round();
    }
}

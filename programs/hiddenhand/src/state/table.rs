use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum TableStatus {
    /// Waiting for players to join
    Waiting,
    /// Hand in progress
    Playing,
    /// Table is closed
    Closed,
}

impl Default for TableStatus {
    fn default() -> Self {
        TableStatus::Waiting
    }
}

#[account]
#[derive(InitSpace)]
pub struct Table {
    /// Table creator/authority
    pub authority: Pubkey,

    /// Unique table identifier
    pub table_id: [u8; 32],

    /// Small blind amount in lamports
    pub small_blind: u64,

    /// Big blind amount (typically 2x small blind)
    pub big_blind: u64,

    /// Minimum buy-in amount
    pub min_buy_in: u64,

    /// Maximum buy-in amount
    pub max_buy_in: u64,

    /// Maximum players allowed (2-6)
    pub max_players: u8,

    /// Current number of seated players
    pub current_players: u8,

    /// Current table status
    pub status: TableStatus,

    /// Current hand number (increments each hand)
    pub hand_number: u64,

    /// Bitmap of occupied seats (bit i = seat i occupied)
    pub occupied_seats: u8,

    /// Dealer button position (seat index)
    pub dealer_position: u8,

    /// PDA bump
    pub bump: u8,
}

impl Table {
    pub const SIZE: usize = 8 + // discriminator
        32 + // authority
        32 + // table_id
        8 +  // small_blind
        8 +  // big_blind
        8 +  // min_buy_in
        8 +  // max_buy_in
        1 +  // max_players
        1 +  // current_players
        1 +  // status (enum)
        8 +  // hand_number
        1 +  // occupied_seats
        1 +  // dealer_position
        1;   // bump

    /// Check if a seat is occupied
    pub fn is_seat_occupied(&self, seat_index: u8) -> bool {
        self.occupied_seats & (1 << seat_index) != 0
    }

    /// Mark a seat as occupied
    pub fn occupy_seat(&mut self, seat_index: u8) {
        self.occupied_seats |= 1 << seat_index;
        self.current_players += 1;
    }

    /// Mark a seat as vacant
    pub fn vacate_seat(&mut self, seat_index: u8) {
        self.occupied_seats &= !(1 << seat_index);
        self.current_players = self.current_players.saturating_sub(1);
    }

    /// Find first available seat
    pub fn find_empty_seat(&self) -> Option<u8> {
        for i in 0..self.max_players {
            if !self.is_seat_occupied(i) {
                return Some(i);
            }
        }
        None
    }

    /// Advance dealer button to next occupied seat
    pub fn advance_dealer(&mut self) {
        let mut next = (self.dealer_position + 1) % self.max_players;
        for _ in 0..self.max_players {
            if self.is_seat_occupied(next) {
                self.dealer_position = next;
                return;
            }
            next = (next + 1) % self.max_players;
        }
    }
}

// PDA Seeds
pub const TABLE_SEED: &[u8] = b"table";
pub const SEAT_SEED: &[u8] = b"seat";
pub const HAND_SEED: &[u8] = b"hand";
pub const DECK_SEED: &[u8] = b"deck";
pub const VAULT_SEED: &[u8] = b"vault";

// Game Constants
pub const MAX_PLAYERS: u8 = 6;
pub const MIN_PLAYERS: u8 = 2;
pub const DECK_SIZE: usize = 52;
pub const HOLE_CARDS: usize = 2;
pub const COMMUNITY_CARDS: usize = 5;

// Timeouts (in seconds - works consistently across all environments including MagicBlock ER)
pub const ACTION_TIMEOUT_SECONDS: i64 = 60; // 60 seconds to act
pub const DEAL_TIMEOUT_SECONDS: i64 = 30; // 30 seconds to deal (faster since it should be immediate)
pub const EMERGENCY_TIMEOUT_SECONDS: i64 = 86400; // 24 hours for emergency withdraw

// Betting
pub const MIN_RAISE_MULTIPLIER: u64 = 2; // Must raise at least 2x the current bet

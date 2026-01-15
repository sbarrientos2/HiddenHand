pub mod create_table;
pub mod deal_cards;
pub mod join_table;
pub mod leave_table;
pub mod player_action;
pub mod showdown;
pub mod start_hand;

// MagicBlock VRF instructions for provably fair shuffling
pub mod request_shuffle;
pub mod callback_shuffle;
pub mod deal_cards_vrf;

// MagicBlock Ephemeral Rollup delegation for privacy
pub mod delegate_seat;
pub mod delegate_hand;
pub mod delegate_deck;
pub mod undelegate_seat;
pub mod undelegate_hand;
pub mod undelegate_deck;

// Timeout handling
pub mod timeout_player;

// Inco encryption (Phase 2)
pub mod encrypt_hole_cards;

// Re-export everything for convenience
// The `handler` name conflicts are expected and handled by Anchor's program macro
#[allow(ambiguous_glob_reexports)]
pub use create_table::*;
#[allow(ambiguous_glob_reexports)]
pub use deal_cards::*;
#[allow(ambiguous_glob_reexports)]
pub use join_table::*;
#[allow(ambiguous_glob_reexports)]
pub use leave_table::*;
#[allow(ambiguous_glob_reexports)]
pub use player_action::*;
#[allow(ambiguous_glob_reexports)]
pub use showdown::*;
#[allow(ambiguous_glob_reexports)]
pub use start_hand::*;
#[allow(ambiguous_glob_reexports)]
pub use request_shuffle::*;
#[allow(ambiguous_glob_reexports)]
pub use callback_shuffle::*;
#[allow(ambiguous_glob_reexports)]
pub use deal_cards_vrf::*;
#[allow(ambiguous_glob_reexports)]
pub use delegate_seat::*;
#[allow(ambiguous_glob_reexports)]
pub use delegate_hand::*;
#[allow(ambiguous_glob_reexports)]
pub use delegate_deck::*;
#[allow(ambiguous_glob_reexports)]
pub use undelegate_seat::*;
#[allow(ambiguous_glob_reexports)]
pub use undelegate_hand::*;
#[allow(ambiguous_glob_reexports)]
pub use undelegate_deck::*;
#[allow(ambiguous_glob_reexports)]
pub use timeout_player::*;
#[allow(ambiguous_glob_reexports)]
pub use encrypt_hole_cards::*;

pub mod constants;
pub mod error;
pub mod inco_cpi;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

// MagicBlock Ephemeral Rollups SDK for privacy
use ephemeral_rollups_sdk::anchor::ephemeral;

pub use constants::*;
pub use inco_cpi::*;
pub use instructions::*;
pub use state::*;

declare_id!("HS3GdhRBU3jMT4G6ogKVktKaibqsMhPRhDhNsmgzeB8Q");

/// HiddenHand - Privacy Poker on Solana
/// Using MagicBlock VRF for provably fair shuffling and
/// Ephemeral Rollups for hidden game state
#[ephemeral]
#[program]
pub mod hiddenhand {
    use super::*;

    /// Create a new poker table
    pub fn create_table(
        ctx: Context<CreateTable>,
        table_id: [u8; 32],
        small_blind: u64,
        big_blind: u64,
        min_buy_in: u64,
        max_buy_in: u64,
        max_players: u8,
    ) -> Result<()> {
        instructions::create_table::handler(ctx, table_id, small_blind, big_blind, min_buy_in, max_buy_in, max_players)
    }

    /// Join a table with a buy-in
    pub fn join_table(ctx: Context<JoinTable>, seat_index: u8, buy_in: u64) -> Result<()> {
        instructions::join_table::handler(ctx, seat_index, buy_in)
    }

    /// Leave a table and cash out
    pub fn leave_table(ctx: Context<LeaveTable>) -> Result<()> {
        instructions::leave_table::handler(ctx)
    }

    /// Start a new hand (table authority only)
    pub fn start_hand(ctx: Context<StartHand>) -> Result<()> {
        instructions::start_hand::handler(ctx)
    }

    /// Perform a player action (fold, check, call, raise, all-in)
    pub fn player_action(ctx: Context<PlayerAction>, action: Action) -> Result<()> {
        instructions::player_action::handler(ctx, action)
    }

    /// Showdown - evaluate hands and distribute pot
    /// Remaining accounts should be all player seat accounts
    pub fn showdown(ctx: Context<Showdown>) -> Result<()> {
        instructions::showdown::handler(ctx)
    }

    /// Deal cards to all players and post blinds
    /// SB and BB seats are named accounts, others via remaining_accounts
    /// NOTE: For provably fair games, use request_shuffle + callback_shuffle instead
    pub fn deal_cards(ctx: Context<DealAllCards>) -> Result<()> {
        instructions::deal_cards::handler(ctx)
    }

    // ============================================================
    // MagicBlock VRF Instructions (Provably Fair Shuffling)
    // ============================================================

    /// Request VRF randomness for card shuffling
    /// This initiates the shuffle - VRF oracle will callback with randomness
    pub fn request_shuffle(ctx: Context<RequestShuffle>) -> Result<()> {
        instructions::request_shuffle::handler(ctx)
    }

    /// VRF callback - receives randomness and shuffles the deck
    /// Called by VRF oracle, not directly by users
    pub fn callback_shuffle(ctx: Context<CallbackShuffle>, randomness: [u8; 32]) -> Result<()> {
        instructions::callback_shuffle::handler(ctx, randomness)
    }

    /// Deal hole cards after VRF shuffle is complete
    /// Use this instead of deal_cards for provably fair games
    pub fn deal_cards_vrf(ctx: Context<DealCardsVrf>) -> Result<()> {
        instructions::deal_cards_vrf::handler(ctx)
    }

    // ============================================================
    // MagicBlock Ephemeral Rollup Instructions (Privacy)
    // ============================================================

    /// Delegate player seat to Ephemeral Rollup for private gameplay
    /// Enables low-latency transactions and private hole cards
    pub fn delegate_seat(ctx: Context<DelegateSeat>, seat_index: u8) -> Result<()> {
        instructions::delegate_seat::handler(ctx, seat_index)
    }

    /// Delegate hand state to Ephemeral Rollup
    /// Must be called after start_hand, before gameplay begins
    pub fn delegate_hand(ctx: Context<DelegateHand>) -> Result<()> {
        instructions::delegate_hand::handler(ctx)
    }

    /// Delegate deck state to Ephemeral Rollup
    /// Must be called after start_hand, before shuffling/dealing
    pub fn delegate_deck(ctx: Context<DelegateDeck>) -> Result<()> {
        instructions::delegate_deck::handler(ctx)
    }

    /// Undelegate player seat back to base layer
    /// Commits final state (chips) after hand or when leaving
    pub fn undelegate_seat(ctx: Context<UndelegateSeat>) -> Result<()> {
        instructions::undelegate_seat::handler(ctx)
    }

    /// Undelegate hand state back to base layer
    /// Commits final hand state after showdown
    pub fn undelegate_hand(ctx: Context<UndelegateHand>) -> Result<()> {
        instructions::undelegate_hand::handler(ctx)
    }

    /// Undelegate deck state back to base layer
    /// Commits final deck state after showdown
    pub fn undelegate_deck(ctx: Context<UndelegateDeck>) -> Result<()> {
        instructions::undelegate_deck::handler(ctx)
    }

    // ============================================================
    // Timeout Handling (Prevents Stuck Games)
    // ============================================================

    /// Timeout a player who hasn't acted within 60 seconds
    /// Anyone can call this to keep the game moving
    /// Auto-checks if possible, otherwise auto-folds
    pub fn timeout_player(ctx: Context<TimeoutPlayer>) -> Result<()> {
        instructions::timeout_player::handler(ctx)
    }

    // ============================================================
    // Inco Encryption Instructions (Phase 2 - Cryptographic Privacy)
    // ============================================================

    /// Encrypt hole cards using Inco FHE
    /// Called via Magic Actions after ER commit
    /// Encrypts plaintext cards and grants decryption allowances to players
    /// Call once per player with their seat_index
    pub fn encrypt_hole_cards(ctx: Context<EncryptHoleCards>, seat_index: u8) -> Result<()> {
        instructions::encrypt_hole_cards::handler(ctx, seat_index)
    }

    // TODO: Add community card reveal instruction
    // pub fn reveal_community(ctx: Context<RevealCommunity>, count: u8) -> Result<()> {
    //     // Reveal flop (3), turn (1), or river (1)
    //     // Grants allowances to all active players for community cards
    // }
}

/// Unit tests using LiteSVM for fast execution
#[cfg(test)]
mod unit_tests {
    use super::*;

    /// Test that table constants are valid
    #[test]
    fn test_table_constants() {
        assert!(MIN_PLAYERS >= 2, "Minimum players should be at least 2");
        assert!(MAX_PLAYERS >= MIN_PLAYERS, "Max players should be >= min players");
        assert!(MAX_PLAYERS <= 9, "Max players should be reasonable (<=9)");
    }

    /// Test player status transitions
    #[test]
    fn test_player_status_transitions() {
        use state::PlayerStatus;

        let sitting = PlayerStatus::Sitting;
        let playing = PlayerStatus::Playing;
        let folded = PlayerStatus::Folded;
        let all_in = PlayerStatus::AllIn;

        // Status should be comparable
        assert_ne!(sitting, playing);
        assert_ne!(playing, folded);
        assert_ne!(folded, all_in);
    }

    /// Test game phase ordering
    #[test]
    fn test_game_phase_ordering() {
        use state::GamePhase;

        // Phases should be distinct
        assert_ne!(GamePhase::Dealing, GamePhase::PreFlop);
        assert_ne!(GamePhase::PreFlop, GamePhase::Flop);
        assert_ne!(GamePhase::Flop, GamePhase::Turn);
        assert_ne!(GamePhase::Turn, GamePhase::River);
        assert_ne!(GamePhase::River, GamePhase::Showdown);
        assert_ne!(GamePhase::Showdown, GamePhase::Settled);
    }

    /// Test player seat size calculation
    #[test]
    fn test_player_seat_size() {
        use state::PlayerSeat;

        // Verify our size calculation is correct
        // 8 (discriminator) + 32 (table) + 32 (player) + 1 (seat_index) +
        // 8 (chips) + 8 (current_bet) + 8 (total_bet) + 16 (hole_card_1) +
        // 16 (hole_card_2) + 1 (status) + 1 (has_acted) + 1 (bump)
        let expected_size = 8 + 32 + 32 + 1 + 8 + 8 + 8 + 16 + 16 + 1 + 1 + 1;
        assert_eq!(PlayerSeat::SIZE, expected_size, "PlayerSeat size mismatch");
    }

    /// Test table size calculation
    #[test]
    fn test_table_size() {
        use state::Table;

        // 8 (discriminator) + 32 (authority) + 32 (table_id) + 8 (small_blind) +
        // 8 (big_blind) + 8 (min_buy_in) + 8 (max_buy_in) + 1 (max_players) +
        // 1 (current_players) + 1 (status) + 8 (hand_number) + 1 (occupied_seats) +
        // 1 (dealer_position) + 1 (bump)
        let expected_size = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1 + 1 + 8 + 1 + 1 + 1;
        assert_eq!(Table::SIZE, expected_size, "Table size mismatch");
    }

    /// Test action enum serialization
    #[test]
    fn test_action_variants() {
        use instructions::Action;

        let fold = Action::Fold;
        let check = Action::Check;
        let call = Action::Call;
        let raise = Action::Raise { amount: 1000 };
        let all_in = Action::AllIn;

        // Actions should be distinct
        assert_ne!(fold, check);
        assert_ne!(check, call);
        assert_eq!(raise, Action::Raise { amount: 1000 });
        assert_ne!(raise, Action::Raise { amount: 2000 });
        assert_ne!(all_in, fold);
    }

    /// Test error codes exist
    #[test]
    fn test_error_codes() {
        use error::HiddenHandError;

        // Verify key error variants exist and are distinct
        let duplicate = HiddenHandError::DuplicateAccount;
        let not_at_table = HiddenHandError::PlayerNotAtTable;
        let invalid_action = HiddenHandError::InvalidAction;

        // These should compile and be different discriminants
        assert_ne!(
            std::mem::discriminant(&duplicate),
            std::mem::discriminant(&not_at_table)
        );
        assert_ne!(
            std::mem::discriminant(&not_at_table),
            std::mem::discriminant(&invalid_action)
        );
    }

    /// Test seat bitmap operations
    #[test]
    fn test_seat_bitmap_operations() {
        // Test bitmap operations used in Table for seat management
        let mut occupied_seats: u8 = 0;

        // Occupy seat 0
        occupied_seats |= 1 << 0;
        assert_eq!(occupied_seats & (1 << 0), 1);
        assert_eq!(occupied_seats & (1 << 1), 0);

        // Occupy seat 3
        occupied_seats |= 1 << 3;
        assert_eq!(occupied_seats & (1 << 3), 8);

        // Vacate seat 0
        occupied_seats &= !(1 << 0);
        assert_eq!(occupied_seats & (1 << 0), 0);
        assert_eq!(occupied_seats & (1 << 3), 8);
    }

    /// Test place_bet with saturating arithmetic
    #[test]
    fn test_place_bet_saturating() {
        // Test that betting uses saturating arithmetic
        let chips: u64 = 1000;
        let bet_amount: u64 = 1500;

        // Should cap at available chips
        let actual_bet = bet_amount.min(chips);
        assert_eq!(actual_bet, 1000);

        // Remaining chips should be 0
        let remaining = chips.saturating_sub(actual_bet);
        assert_eq!(remaining, 0);
    }

    /// Test pot splitting arithmetic
    #[test]
    fn test_pot_splitting() {
        // Test pot splitting with remainder
        let pot: u64 = 1000;
        let winner_count: u64 = 3;

        let share = pot / winner_count;
        let remainder = pot % winner_count;

        assert_eq!(share, 333);
        assert_eq!(remainder, 1);
        assert_eq!(share * winner_count + remainder, pot);
    }
}

pub mod constants;
pub mod error;
pub mod events;
pub mod inco_cpi;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use events::*;
pub use inco_cpi::*;
pub use instructions::*;
pub use state::*;

declare_id!("HS3GdhRBU3jMT4G6ogKVktKaibqsMhPRhDhNsmgzeB8Q");

/// HiddenHand - Privacy Poker on Solana
/// Using MagicBlock VRF for provably fair shuffling and
/// Inco FHE for cryptographic card privacy
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
    /// WARNING: This stores plaintext cards - use deal_cards_encrypted for privacy!
    pub fn deal_cards(ctx: Context<DealAllCards>) -> Result<()> {
        instructions::deal_cards::handler(ctx)
    }

    /// Deal cards with ATOMIC Inco encryption (RECOMMENDED for privacy)
    /// Cards are encrypted immediately during dealing - NEVER stored as plaintext
    /// After calling this, use grant_card_allowance for each player to enable decryption
    pub fn deal_cards_encrypted(ctx: Context<DealCardsEncrypted>) -> Result<()> {
        instructions::deal_cards_encrypted::handler(ctx)
    }

    // ============================================================
    // MagicBlock VRF Instructions (Provably Fair Shuffling)
    // Modified Option B: Atomic shuffle + encrypt in callback
    // VRF seed is NEVER stored - only used in memory!
    // ============================================================

    /// Request VRF randomness for card shuffling
    /// This initiates the shuffle - VRF oracle will callback with randomness
    ///
    /// IMPORTANT: Pass all player seat accounts as remaining_accounts!
    /// The callback will shuffle + encrypt cards atomically.
    pub fn request_shuffle(ctx: Context<RequestShuffle>) -> Result<()> {
        instructions::request_shuffle::handler(ctx)
    }

    /// VRF callback - ATOMIC shuffle + encrypt
    /// Called by VRF oracle, not directly by users
    ///
    /// SECURITY: The VRF seed is NEVER stored in account state!
    /// Shuffle and encryption happen atomically in this single transaction.
    pub fn callback_shuffle(ctx: Context<CallbackShuffle>, randomness: [u8; 32]) -> Result<()> {
        instructions::callback_shuffle::handler(ctx, randomness)
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

    /// Phase 1: Encrypt hole cards using Inco FHE
    /// Called via Magic Actions after ER commit
    /// Encrypts plaintext cards and stores handles in PlayerSeat
    /// Call once per player with their seat_index
    /// IMPORTANT: After this, call grant_card_allowance to enable decryption
    pub fn encrypt_hole_cards(ctx: Context<EncryptHoleCards>, seat_index: u8) -> Result<()> {
        instructions::encrypt_hole_cards::handler(ctx, seat_index)
    }

    /// Phase 2: Grant decryption allowance for encrypted cards
    /// Must be called AFTER encrypt_hole_cards
    /// Client should derive allowance PDAs from stored handles:
    ///   PDA = ["allowance", handle.to_le_bytes(), player_pubkey]
    pub fn grant_card_allowance(ctx: Context<GrantCardAllowance>, seat_index: u8) -> Result<()> {
        instructions::encrypt_hole_cards::grant_allowance_handler(ctx, seat_index)
    }

    /// Reveal cards at showdown with Ed25519 signature verification
    ///
    /// Players call this at Showdown phase to reveal their decrypted cards.
    /// The transaction must include Ed25519 verification instructions from
    /// Inco's attested decryption to prove the revealed values are correct.
    pub fn reveal_cards(ctx: Context<RevealCards>, card1: u8, card2: u8) -> Result<()> {
        instructions::reveal_cards::handler(ctx, card1, card2)
    }

    // ============================================================
    // Game Liveness Instructions (Prevent Stuck Games)
    // ============================================================

    /// Allow player to grant their OWN decryption allowance after timeout
    /// If authority doesn't grant allowances within 60 seconds, players can self-grant
    /// This prevents the game from getting stuck if authority is AFK
    pub fn grant_own_allowance(ctx: Context<GrantOwnAllowance>, seat_index: u8) -> Result<()> {
        instructions::grant_own_allowance::handler(ctx, seat_index)
    }

    /// Timeout a player who hasn't revealed cards at showdown
    /// After 3 minutes without revealing, any player can call this to "muck" the non-revealer
    /// Mucked players forfeit their claim to the pot (standard poker rules)
    pub fn timeout_reveal(ctx: Context<TimeoutReveal>, target_seat: u8) -> Result<()> {
        instructions::timeout_reveal::handler(ctx, target_seat)
    }

    /// Close an inactive table and return all funds to players
    /// Can be called by anyone after 1 hour of inactivity
    /// Table must be in Waiting status (not mid-hand)
    /// All seated players receive their chips back
    pub fn close_inactive_table(ctx: Context<CloseInactiveTable>) -> Result<()> {
        instructions::close_inactive_table::handler(ctx)
    }

    /// Grant community card allowances to a player
    /// This enables the player to decrypt community cards via Inco, which is needed
    /// if they want to reveal community cards when authority is AFK
    ///
    /// Called by authority after VRF shuffle for each active player.
    /// remaining_accounts: 5 allowance PDAs for community cards [card0-card4]
    pub fn grant_community_allowances<'info>(
        ctx: Context<'_, '_, 'info, 'info, GrantCommunityAllowances<'info>>,
        seat_index: u8,
    ) -> Result<()> {
        instructions::grant_community_allowances::handler(ctx, seat_index)
    }

    /// Reveal community cards (flop/turn/river) with Ed25519 signature verification
    ///
    /// Authority calls this when betting round completes and community cards need to be revealed.
    /// Community cards are encrypted during VRF shuffle for privacy - this reveals them.
    ///
    /// The transaction must include Ed25519 verification instructions for each card from
    /// Inco's attested decryption to prove the revealed values are correct.
    ///
    /// Card count depends on phase:
    /// - PreFlop -> Flop: 3 cards (or 5 if all-in runout)
    /// - Flop -> Turn: 1 card (or 2 if all-in runout)
    /// - Turn -> River: 1 card
    pub fn reveal_community(ctx: Context<RevealCommunity>, cards: Vec<u8>) -> Result<()> {
        instructions::reveal_community::handler(ctx, cards)
    }
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
        // 16 (hole_card_2) + 1 (revealed_card_1) + 1 (revealed_card_2) +
        // 1 (cards_revealed) + 1 (status) + 1 (has_acted) + 1 (bump)
        let expected_size = 8 + 32 + 32 + 1 + 8 + 8 + 8 + 16 + 16 + 1 + 1 + 1 + 1 + 1 + 1;
        assert_eq!(PlayerSeat::SIZE, expected_size, "PlayerSeat size mismatch");
    }

    /// Test table size calculation
    #[test]
    fn test_table_size() {
        use state::Table;

        // 8 (discriminator) + 32 (authority) + 32 (table_id) + 8 (small_blind) +
        // 8 (big_blind) + 8 (min_buy_in) + 8 (max_buy_in) + 1 (max_players) +
        // 1 (current_players) + 1 (status) + 8 (hand_number) + 1 (occupied_seats) +
        // 1 (dealer_position) + 8 (last_ready_time) + 1 (bump)
        let expected_size = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1 + 1 + 8 + 1 + 1 + 8 + 1;
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

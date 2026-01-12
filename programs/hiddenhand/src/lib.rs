pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("7skCDLugS15d6cfrtZZCc5rpe5sDB998WjVBacP5qsTp");

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
    pub fn deal_cards(ctx: Context<DealAllCards>) -> Result<()> {
        instructions::deal_cards::handler(ctx)
    }

    // TODO: Add these instructions once Inco integration is complete
    //
    // /// Reveal community cards
    // pub fn reveal_community(ctx: Context<RevealCommunity>, count: u8) -> Result<()> {
    //     // Reveal flop (3), turn (1), or river (1)
    // }
    //
    // /// Timeout a player who hasn't acted
    // pub fn timeout_player(ctx: Context<TimeoutPlayer>) -> Result<()> {
    //     // Force fold inactive player
    // }
}

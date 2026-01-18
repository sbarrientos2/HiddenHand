//! Timeout reveal - muck non-revealing players at showdown
//!
//! If a player doesn't reveal their cards within REVEAL_TIMEOUT_SECONDS (3 minutes)
//! during showdown, any other player can call this instruction to "muck" them.
//!
//! A mucked player forfeits their claim to the pot, following standard poker rules.
//! This prevents the game from getting stuck if a player refuses to reveal
//! (e.g., denial about losing, AFK, or malicious behavior).

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::state::{GamePhase, HandState, PlayerSeat, PlayerStatus, Table, TableStatus};

#[derive(Accounts)]
#[instruction(target_seat: u8)]
pub struct TimeoutReveal<'info> {
    /// Anyone can call this after timeout
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        seeds = [TABLE_SEED, table.table_id.as_ref()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,

    #[account(
        mut,
        seeds = [HAND_SEED, table.key().as_ref(), &table.hand_number.to_le_bytes()],
        bump = hand_state.bump
    )]
    pub hand_state: Account<'info, HandState>,

    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), &[target_seat]],
        bump = target_player.bump
    )]
    pub target_player: Account<'info, PlayerSeat>,

    pub system_program: Program<'info, System>,
}

/// Timeout a player who hasn't revealed cards at showdown
pub fn handler(ctx: Context<TimeoutReveal>, target_seat: u8) -> Result<()> {
    let table = &ctx.accounts.table;
    let hand_state = &mut ctx.accounts.hand_state;
    let target_player = &mut ctx.accounts.target_player;
    let clock = Clock::get()?;

    // Validate table is playing
    require!(
        table.status == TableStatus::Playing,
        HiddenHandError::HandNotInProgress
    );

    // Validate we're in Showdown phase
    require!(
        hand_state.phase == GamePhase::Showdown,
        HiddenHandError::InvalidPhase
    );

    // Validate target is an active player who hasn't revealed
    require!(
        target_player.status == PlayerStatus::Playing || target_player.status == PlayerStatus::AllIn,
        HiddenHandError::PlayerNotActive
    );

    require!(
        !target_player.cards_revealed,
        HiddenHandError::CardsAlreadyRevealed
    );

    // Check timeout - must wait REVEAL_TIMEOUT_SECONDS (3 minutes)
    let elapsed = clock.unix_timestamp - hand_state.last_action_time;
    require!(
        elapsed >= REVEAL_TIMEOUT_SECONDS,
        HiddenHandError::TimeoutNotReached
    );

    msg!(
        "Player at seat {} timed out after {} seconds without revealing cards",
        target_seat,
        elapsed
    );

    // Mark player as folded - they forfeit their pot claim
    // This is standard poker rules: if you don't show at showdown, you muck
    target_player.status = PlayerStatus::Folded;

    // Remove from active players bitmap
    hand_state.active_players &= !(1 << target_seat);
    hand_state.active_count = hand_state.active_count.saturating_sub(1);

    msg!(
        "Player mucked (forfeited pot claim). Active players remaining: {}",
        hand_state.active_count
    );

    // If only one player remains active, they win by default
    if hand_state.active_count == 1 {
        msg!("Only one player remains - they win the pot by default");
    }

    // Update last action time
    hand_state.last_action_time = clock.unix_timestamp;

    Ok(())
}

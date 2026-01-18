//! Grant own allowance after timeout
//!
//! If the authority doesn't grant decryption allowances within the timeout period,
//! players can grant their OWN allowance to prevent the game from getting stuck.
//!
//! This ensures game liveness - no player is dependent on the authority for
//! decrypting their own cards.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::inco_cpi::{self, INCO_PROGRAM_ID};
use crate::state::{GamePhase, HandState, PlayerSeat, PlayerStatus, Table, TableStatus};

#[derive(Accounts)]
#[instruction(seat_index: u8)]
pub struct GrantOwnAllowance<'info> {
    /// The player granting their own allowance (must be the seat owner)
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        seeds = [TABLE_SEED, table.table_id.as_ref()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,

    #[account(
        seeds = [HAND_SEED, table.key().as_ref(), &table.hand_number.to_le_bytes()],
        bump = hand_state.bump
    )]
    pub hand_state: Account<'info, HandState>,

    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), &[seat_index]],
        bump = player_seat.bump,
        constraint = player_seat.player == player.key() @ HiddenHandError::NotYourSeat
    )]
    pub player_seat: Account<'info, PlayerSeat>,

    /// Allowance account for card 1 (will be created by Inco CPI)
    /// CHECK: Created by Inco program
    #[account(mut)]
    pub allowance_card1: AccountInfo<'info>,

    /// Allowance account for card 2 (will be created by Inco CPI)
    /// CHECK: Created by Inco program
    #[account(mut)]
    pub allowance_card2: AccountInfo<'info>,

    /// The Inco Lightning program
    /// CHECK: Verified by address constraint
    #[account(address = INCO_PROGRAM_ID)]
    pub inco_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// Allow a player to grant their own decryption allowance after timeout
pub fn handler(ctx: Context<GrantOwnAllowance>, _seat_index: u8) -> Result<()> {
    let table = &ctx.accounts.table;
    let hand_state = &ctx.accounts.hand_state;
    let player_seat = &ctx.accounts.player_seat;
    let clock = Clock::get()?;

    // Validate table is playing
    require!(
        table.status == TableStatus::Playing,
        HiddenHandError::HandNotInProgress
    );

    // Validate we're past the Dealing phase (cards have been dealt)
    require!(
        hand_state.phase != GamePhase::Dealing,
        HiddenHandError::InvalidPhase
    );

    // Validate player is actively in the hand
    require!(
        player_seat.status == PlayerStatus::Playing || player_seat.status == PlayerStatus::AllIn,
        HiddenHandError::PlayerNotActive
    );

    // Check timeout - allow self-grant after ALLOWANCE_TIMEOUT_SECONDS
    let elapsed = clock.unix_timestamp - hand_state.last_action_time;
    require!(
        elapsed >= ALLOWANCE_TIMEOUT_SECONDS,
        HiddenHandError::TimeoutNotReached
    );

    // Verify cards are encrypted (handles > 51)
    let handle1 = player_seat.hole_card_1;
    let handle2 = player_seat.hole_card_2;

    require!(
        handle1 > 51 && handle2 > 51,
        HiddenHandError::CardsNotEncrypted
    );

    msg!(
        "Player {} granting own allowance after {} seconds timeout",
        player_seat.player,
        elapsed
    );
    msg!("Handle 1: {}, Handle 2: {}", handle1, handle2);

    // Get account infos for Inco CPI
    let player_info = ctx.accounts.player.to_account_info();
    let allowance1_info = ctx.accounts.allowance_card1.to_account_info();
    let allowance2_info = ctx.accounts.allowance_card2.to_account_info();
    let system_info = ctx.accounts.system_program.to_account_info();
    let player_key = ctx.accounts.player.key();

    // Build account infos for CPI
    let account_infos = &[
        allowance1_info.clone(),
        player_info.clone(),
        system_info.clone(),
    ];

    // Grant allowance for card 1
    inco_cpi::grant_allowance_with_pubkey(
        &player_info,
        &allowance1_info,
        &player_key, // Player grants to themselves
        &system_info,
        handle1,
        account_infos,
    )?;

    // Rebuild for card 2
    let account_infos2 = &[
        allowance2_info.clone(),
        player_info.clone(),
        system_info.clone(),
    ];

    // Grant allowance for card 2
    inco_cpi::grant_allowance_with_pubkey(
        &player_info,
        &allowance2_info,
        &player_key, // Player grants to themselves
        &system_info,
        handle2,
        account_infos2,
    )?;

    msg!("Self-granted allowances for both cards successfully");

    Ok(())
}

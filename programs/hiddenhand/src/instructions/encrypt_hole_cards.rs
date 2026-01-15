//! Encrypt hole cards using Inco FHE
//!
//! This instruction is called via Magic Actions after the ER commits.
//! It encrypts the plaintext hole cards and grants decryption allowances to players.
//!
//! Flow:
//! 1. ER shuffles and deals cards (plaintext in TEE RAM)
//! 2. ER schedules Magic Action to call this instruction after commit
//! 3. This instruction runs on base layer, encrypts cards via Inco CPI
//! 4. Players can now decrypt only their own cards via Inco

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::inco_cpi::{self, INCO_PROGRAM_ID};
use crate::state::{GamePhase, HandState, PlayerSeat, PlayerStatus, Table, TableStatus};

/// Encrypt a single player's hole cards
/// This is simpler than batch encryption and avoids complex account handling
#[derive(Accounts)]
#[instruction(seat_index: u8)]
pub struct EncryptHoleCards<'info> {
    /// The table authority
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [TABLE_SEED, table.table_id.as_ref()],
        bump = table.bump,
        constraint = table.authority == authority.key() @ HiddenHandError::UnauthorizedAuthority
    )]
    pub table: Account<'info, Table>,

    #[account(
        seeds = [HAND_SEED, table.key().as_ref(), &table.hand_number.to_le_bytes()],
        bump = hand_state.bump,
        constraint = hand_state.phase == GamePhase::PreFlop @ HiddenHandError::InvalidPhase
    )]
    pub hand_state: Account<'info, HandState>,

    /// The player seat to encrypt cards for
    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), &[seat_index]],
        bump = player_seat.bump,
        constraint = player_seat.status == PlayerStatus::Playing @ HiddenHandError::PlayerFolded
    )]
    pub player_seat: Account<'info, PlayerSeat>,

    /// Allowance account for card 1 (PDA from Inco)
    /// CHECK: Will be created by Inco if needed
    #[account(mut)]
    pub allowance_card1: AccountInfo<'info>,

    /// Allowance account for card 2 (PDA from Inco)
    /// CHECK: Will be created by Inco if needed
    #[account(mut)]
    pub allowance_card2: AccountInfo<'info>,

    /// The player's wallet (needed for allowance CPI)
    /// CHECK: Just needs the pubkey for allowance
    pub player: AccountInfo<'info>,

    /// The Inco Lightning program for encryption
    /// CHECK: Verified by address constraint
    #[account(address = INCO_PROGRAM_ID)]
    pub inco_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// Encrypt hole cards for a single player
pub fn handler(ctx: Context<EncryptHoleCards>, _seat_index: u8) -> Result<()> {
    let table = &ctx.accounts.table;
    let player_seat = &mut ctx.accounts.player_seat;

    // Validate table is in playing state
    require!(
        table.status == TableStatus::Playing,
        HiddenHandError::HandNotInProgress
    );

    // Check if cards look like plaintext (0-51) vs encrypted handle (large number)
    let card1 = player_seat.hole_card_1;
    let card2 = player_seat.hole_card_2;

    if card1 > 51 && card2 > 51 {
        msg!("Cards already encrypted for seat {}", player_seat.seat_index);
        return Ok(());
    }

    // Validate player matches
    require!(
        player_seat.player == ctx.accounts.player.key(),
        HiddenHandError::PlayerNotAtTable
    );

    msg!(
        "Encrypting cards for seat {} (player {}): card1={}, card2={}",
        player_seat.seat_index,
        player_seat.player,
        card1,
        card2
    );

    // Get account infos for CPI
    let authority_info = ctx.accounts.authority.to_account_info();
    let allowance1_info = ctx.accounts.allowance_card1.to_account_info();
    let allowance2_info = ctx.accounts.allowance_card2.to_account_info();
    let player_info = ctx.accounts.player.to_account_info();
    let system_info = ctx.accounts.system_program.to_account_info();

    // Encrypt card 1
    let encrypted1 = inco_cpi::encrypt_card(&authority_info, card1 as u8)?;

    // Grant allowance for card 1
    inco_cpi::grant_allowance_with_pubkey(
        &authority_info,
        &allowance1_info,
        &player_seat.player,
        &system_info,
        encrypted1.unwrap(),
        &[
            allowance1_info.clone(),
            authority_info.clone(),
            player_info.clone(),
            system_info.clone(),
        ],
    )?;

    // Encrypt card 2
    let encrypted2 = inco_cpi::encrypt_card(&authority_info, card2 as u8)?;

    // Grant allowance for card 2
    inco_cpi::grant_allowance_with_pubkey(
        &authority_info,
        &allowance2_info,
        &player_seat.player,
        &system_info,
        encrypted2.unwrap(),
        &[
            allowance2_info.clone(),
            authority_info.clone(),
            player_info.clone(),
            system_info.clone(),
        ],
    )?;

    // Update seat with encrypted handles
    player_seat.hole_card_1 = encrypted1.unwrap();
    player_seat.hole_card_2 = encrypted2.unwrap();

    msg!(
        "Encrypted cards for seat {}: {} -> {}, {} -> {}",
        player_seat.seat_index,
        card1,
        encrypted1.unwrap(),
        card2,
        encrypted2.unwrap()
    );

    Ok(())
}

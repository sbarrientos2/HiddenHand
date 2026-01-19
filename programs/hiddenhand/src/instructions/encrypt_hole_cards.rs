//! Encrypt hole cards using Inco FHE
//!
//! This module provides two-phase encryption:
//! 1. `encrypt_hole_cards` - Encrypts plaintext cards, stores handles in PlayerSeat
//! 2. `grant_card_allowance` - Uses stored handles to grant decryption access
//!
//! Why two phases? The allowance account PDA depends on the encrypted handle:
//!   PDA = ["allowance", handle_bytes, player_pubkey]
//! We don't know the handle until AFTER encryption, so we must split the flow.
//!
//! Flow:
//! 1. ER shuffles and deals cards (plaintext in TEE RAM)
//! 2. Magic Action calls `encrypt_hole_cards` after commit
//! 3. Client reads stored handles and computes allowance PDAs
//! 4. Client calls `grant_card_allowance` with correct PDAs
//! 5. Player can now decrypt their cards via Inco

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::inco_cpi::{self, INCO_PROGRAM_ID};
use crate::state::{GamePhase, HandState, PlayerSeat, PlayerStatus, Table, TableStatus};

/// Phase 1: Encrypt a player's hole cards
///
/// This instruction ONLY encrypts - it does not grant allowances.
/// After this completes, the client should:
/// 1. Read the encrypted handles from player_seat.hole_card_1/2
/// 2. Derive allowance PDAs using: ["allowance", handle_bytes, player_pubkey]
/// 3. Call grant_card_allowance with those PDAs
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

    /// The Inco Lightning program for encryption
    /// CHECK: Verified by address constraint
    #[account(address = INCO_PROGRAM_ID)]
    pub inco_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// Phase 1: Encrypt hole cards (stores handles for later allowance granting)
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

    msg!(
        "Encrypting cards for seat {} (player {}): card1={}, card2={}",
        player_seat.seat_index,
        player_seat.player,
        card1,
        card2
    );

    // Get account infos for CPI
    let authority_info = ctx.accounts.authority.to_account_info();

    // Encrypt card 1
    let encrypted1 = inco_cpi::encrypt_card(&authority_info, card1 as u8)?;

    // Encrypt card 2
    let encrypted2 = inco_cpi::encrypt_card(&authority_info, card2 as u8)?;

    // Update seat with encrypted handles
    player_seat.hole_card_1 = encrypted1.unwrap();
    player_seat.hole_card_2 = encrypted2.unwrap();

    msg!(
        "Encrypted cards for seat {}: {} -> handle {}, {} -> handle {}",
        player_seat.seat_index,
        card1,
        player_seat.hole_card_1,
        card2,
        player_seat.hole_card_2
    );

    msg!(
        "Next step: Call grant_card_allowance with PDAs derived from handles"
    );

    Ok(())
}

/// Phase 2: Grant decryption allowance for encrypted cards
///
/// This instruction grants the player permission to decrypt their cards.
/// The allowance PDAs must be derived correctly from the encrypted handles.
#[derive(Accounts)]
#[instruction(seat_index: u8)]
pub struct GrantCardAllowance<'info> {
    /// The table authority - only authority can grant allowances
    #[account(
        mut,
        constraint = table.authority == authority.key() @ HiddenHandError::UnauthorizedAuthority
    )]
    pub authority: Signer<'info>,

    #[account(
        seeds = [TABLE_SEED, table.table_id.as_ref()],
        bump = table.bump,
    )]
    pub table: Account<'info, Table>,

    /// The player seat with encrypted cards
    #[account(
        seeds = [SEAT_SEED, table.key().as_ref(), &[seat_index]],
        bump = player_seat.bump,
        constraint = player_seat.status == PlayerStatus::Playing @ HiddenHandError::PlayerFolded,
        // Cards must be encrypted (handles > 51)
        constraint = player_seat.hole_card_1 > 51 @ HiddenHandError::CardsNotDealt,
    )]
    pub player_seat: Account<'info, PlayerSeat>,

    /// Allowance account for card 1
    /// Must be PDA: ["allowance", hole_card_1.to_le_bytes(), player_pubkey]
    /// CHECK: Will be created/verified by Inco CPI
    #[account(mut)]
    pub allowance_card1: AccountInfo<'info>,

    /// Allowance account for card 2
    /// Must be PDA: ["allowance", hole_card_2.to_le_bytes(), player_pubkey]
    /// CHECK: Will be created/verified by Inco CPI
    #[account(mut)]
    pub allowance_card2: AccountInfo<'info>,

    /// The player who should be able to decrypt
    /// CHECK: Used for allowance destination
    pub player: AccountInfo<'info>,

    /// The Inco Lightning program
    /// CHECK: Verified by address constraint
    #[account(address = INCO_PROGRAM_ID)]
    pub inco_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// Phase 2: Grant card allowance after encryption
pub fn grant_allowance_handler(ctx: Context<GrantCardAllowance>, _seat_index: u8) -> Result<()> {
    let player_seat = &ctx.accounts.player_seat;

    // Verify player matches seat
    require!(
        player_seat.player == ctx.accounts.player.key(),
        HiddenHandError::PlayerNotAtTable
    );

    let handle1 = player_seat.hole_card_1;
    let handle2 = player_seat.hole_card_2;

    msg!(
        "Granting allowances for seat {} (player {}): handle1={}, handle2={}",
        player_seat.seat_index,
        player_seat.player,
        handle1,
        handle2
    );

    // Get account infos for CPI
    let authority_info = ctx.accounts.authority.to_account_info();
    let allowance1_info = ctx.accounts.allowance_card1.to_account_info();
    let allowance2_info = ctx.accounts.allowance_card2.to_account_info();
    let player_info = ctx.accounts.player.to_account_info();
    let system_info = ctx.accounts.system_program.to_account_info();

    // Grant allowance for card 1
    inco_cpi::grant_allowance_with_pubkey(
        &authority_info,
        &allowance1_info,
        &player_seat.player,
        &system_info,
        handle1,
        &[
            allowance1_info.clone(),
            authority_info.clone(),
            player_info.clone(),
            system_info.clone(),
        ],
    )?;

    // Grant allowance for card 2
    inco_cpi::grant_allowance_with_pubkey(
        &authority_info,
        &allowance2_info,
        &player_seat.player,
        &system_info,
        handle2,
        &[
            allowance2_info.clone(),
            authority_info.clone(),
            player_info.clone(),
            system_info.clone(),
        ],
    )?;

    msg!(
        "Allowances granted for seat {}. Player {} can now decrypt their cards.",
        player_seat.seat_index,
        player_seat.player
    );

    Ok(())
}

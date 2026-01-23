//! Grant community card allowances to all players
//!
//! This instruction grants decryption access for community cards to all active players.
//! This enables any player to reveal community cards if the authority is AFK.
//!
//! Called after VRF shuffle completes, alongside hole card allowance grants.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::inco_cpi::{self, INCO_PROGRAM_ID};
use crate::state::{DeckState, GamePhase, HandState, PlayerSeat, PlayerStatus, Table, TableStatus};

/// Grant community card allowances to a single player
///
/// This instruction is called once per player to grant them access to all 5 community cards.
/// The frontend calls this for each active player after VRF shuffle completes.
///
/// remaining_accounts: [allowance_pda_card0, allowance_pda_card1, ..., allowance_pda_card4]
#[derive(Accounts)]
#[instruction(seat_index: u8)]
pub struct GrantCommunityAllowances<'info> {
    /// Authority granting allowances (only authority can grant)
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
        bump = hand_state.bump
    )]
    pub hand_state: Account<'info, HandState>,

    #[account(
        seeds = [DECK_SEED, table.key().as_ref(), &table.hand_number.to_le_bytes()],
        bump = deck_state.bump
    )]
    pub deck_state: Account<'info, DeckState>,

    /// The player seat to grant allowances for
    #[account(
        seeds = [SEAT_SEED, table.key().as_ref(), &[seat_index]],
        bump = player_seat.bump,
        constraint = player_seat.status == PlayerStatus::Playing || player_seat.status == PlayerStatus::AllIn @ HiddenHandError::PlayerNotActive
    )]
    pub player_seat: Account<'info, PlayerSeat>,

    /// The player who should be able to decrypt
    /// CHECK: Used for allowance destination, verified against player_seat.player
    #[account(constraint = player.key() == player_seat.player @ HiddenHandError::PlayerNotAtTable)]
    pub player: AccountInfo<'info>,

    /// The Inco Lightning program
    /// CHECK: Verified by address constraint
    #[account(address = INCO_PROGRAM_ID)]
    pub inco_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    // remaining_accounts: 5 allowance PDAs for community cards [card0, card1, card2, card3, card4]
}

/// Grant community card allowances to a player
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, GrantCommunityAllowances<'info>>, _seat_index: u8) -> Result<()> {
    let table = &ctx.accounts.table;
    let hand_state = &ctx.accounts.hand_state;
    let deck_state = &ctx.accounts.deck_state;
    let player_seat = &ctx.accounts.player_seat;

    // Validate table is playing
    require!(
        table.status == TableStatus::Playing,
        HiddenHandError::HandNotInProgress
    );

    // Validate we're in a valid phase (after dealing, before showdown)
    require!(
        !matches!(hand_state.phase, GamePhase::Dealing | GamePhase::Settled),
        HiddenHandError::InvalidPhase
    );

    // Need exactly 5 remaining accounts (one allowance PDA per community card)
    require!(
        ctx.remaining_accounts.len() == 5,
        HiddenHandError::InvalidAction
    );

    let player_pubkey = player_seat.player;
    let authority_info = ctx.accounts.authority.to_account_info();
    let player_info = ctx.accounts.player.to_account_info();
    let system_info = ctx.accounts.system_program.to_account_info();

    msg!(
        "Granting community card allowances to player {} (seat {})",
        player_pubkey,
        player_seat.seat_index
    );

    // Grant allowance for each of the 5 community cards
    for (i, allowance_account) in ctx.remaining_accounts.iter().enumerate() {
        let handle = deck_state.cards[i];

        // Verify handle is encrypted (> 255 indicates Inco handle)
        if handle <= 255 {
            msg!("Community card {} not encrypted (handle={}), skipping", i, handle);
            continue;
        }

        msg!("Granting allowance for community card {}: handle {}", i, handle);

        // Build account infos for CPI (must include player for Inco)
        let account_infos = &[
            allowance_account.clone(),
            authority_info.clone(),
            player_info.clone(),
            system_info.clone(),
        ];

        inco_cpi::grant_allowance_with_pubkey(
            &authority_info,
            allowance_account,
            &player_pubkey,
            &system_info,
            handle,
            account_infos,
        )?;
    }

    msg!(
        "Community card allowances granted to player {}",
        player_pubkey
    );

    Ok(())
}

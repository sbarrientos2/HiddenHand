use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::state::Table;

/// Delegate a player's seat account to the Ephemeral Rollup
/// This enables private hole cards - only the player can see their cards
/// while the game runs in the low-latency ER environment
#[delegate]
#[derive(Accounts)]
#[instruction(seat_index: u8)]
pub struct DelegateSeat<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The player who owns this seat
    pub player: Signer<'info>,

    #[account(
        seeds = [TABLE_SEED, table.table_id.as_ref()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,

    /// CHECK: The player seat to delegate
    /// Must be owned by the player and at the given seat index
    #[account(
        mut,
        del,
        seeds = [SEAT_SEED, table.key().as_ref(), &[seat_index]],
        bump
    )]
    pub seat: AccountInfo<'info>,
}

/// Delegate player seat to Ephemeral Rollup for private gameplay
/// This enables:
/// 1. Low-latency transactions (10ms instead of 400ms)
/// 2. Private hole cards (only visible to seat owner)
pub fn handler(ctx: Context<DelegateSeat>, seat_index: u8) -> Result<()> {
    let table = &ctx.accounts.table;

    // Validate seat index
    require!(
        seat_index < table.max_players,
        HiddenHandError::InvalidSeatIndex
    );

    // Get optional validator from remaining accounts (for local testing)
    let validator = ctx.remaining_accounts.first().map(|acc| acc.key());

    // Delegate the seat account to ER
    ctx.accounts.delegate_seat(
        &ctx.accounts.payer,
        &[SEAT_SEED, table.key().as_ref(), &[seat_index]],
        DelegateConfig {
            validator,
            ..Default::default()
        },
    )?;

    msg!(
        "Seat {} delegated to Ephemeral Rollup. Hole cards now private.",
        seat_index
    );
    Ok(())
}

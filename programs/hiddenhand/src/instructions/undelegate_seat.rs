use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;

use crate::constants::*;
use crate::state::{PlayerSeat, Table};

/// Undelegate a player's seat from the Ephemeral Rollup
/// This commits the final state (chips, etc.) back to the base layer
/// Called after showdown or when leaving the table
#[commit]
#[derive(Accounts)]
pub struct UndelegateSeat<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [TABLE_SEED, table.table_id.as_ref()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,

    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), &[seat.seat_index]],
        bump = seat.bump
    )]
    pub seat: Account<'info, PlayerSeat>,
}

/// Undelegate player seat from Ephemeral Rollup
/// Commits the current state (chip count, etc.) to the base layer
pub fn handler(ctx: Context<UndelegateSeat>) -> Result<()> {
    let seat = &ctx.accounts.seat;

    // Commit and undelegate the seat account
    commit_and_undelegate_accounts(
        &ctx.accounts.payer,
        vec![&seat.to_account_info()],
        &ctx.accounts.magic_context,
        &ctx.accounts.magic_program,
    )?;

    msg!(
        "Seat {} undelegated from ER. Chips: {}",
        seat.seat_index,
        seat.chips
    );
    Ok(())
}

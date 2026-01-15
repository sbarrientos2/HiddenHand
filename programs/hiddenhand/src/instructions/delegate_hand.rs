use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::state::{Table, TableStatus};

/// Delegate the hand state account to the Ephemeral Rollup
/// This must be done after start_hand creates the account, before gameplay begins
/// Enables private game state on the low-latency ER environment
#[delegate]
#[derive(Accounts)]
pub struct DelegateHand<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The table authority who can delegate game state
    pub authority: Signer<'info>,

    #[account(
        seeds = [TABLE_SEED, table.table_id.as_ref()],
        bump = table.bump,
        constraint = table.authority == authority.key() @ HiddenHandError::UnauthorizedAuthority,
        constraint = table.status == TableStatus::Playing @ HiddenHandError::HandNotInProgress
    )]
    pub table: Account<'info, Table>,

    /// CHECK: The hand state account to delegate
    /// Must be for the current hand number
    #[account(
        mut,
        del,
        seeds = [HAND_SEED, table.key().as_ref(), &table.hand_number.to_le_bytes()],
        bump
    )]
    pub hand_state: AccountInfo<'info>,
}

/// Delegate hand state to Ephemeral Rollup for private gameplay
/// This enables:
/// 1. Low-latency transactions (10ms instead of 400ms)
/// 2. Private pot and betting state during the hand
pub fn handler(ctx: Context<DelegateHand>) -> Result<()> {
    let table = &ctx.accounts.table;

    // Get optional validator from remaining accounts (for local testing)
    let validator = ctx.remaining_accounts.first().map(|acc| acc.key());

    // Delegate the hand state account to ER
    ctx.accounts.delegate_hand_state(
        &ctx.accounts.payer,
        &[
            HAND_SEED,
            table.key().as_ref(),
            &table.hand_number.to_le_bytes(),
        ],
        DelegateConfig {
            validator,
            ..Default::default()
        },
    )?;

    msg!(
        "Hand state for hand #{} delegated to Ephemeral Rollup",
        table.hand_number
    );
    Ok(())
}

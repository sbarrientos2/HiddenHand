use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::state::{Table, TableStatus};

/// Delegate the deck state account to the Ephemeral Rollup
/// This must be done after start_hand creates the account, before shuffling
/// Enables private deck state on the low-latency ER environment
#[delegate]
#[derive(Accounts)]
pub struct DelegateDeck<'info> {
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

    /// CHECK: The deck state account to delegate
    /// Must be for the current hand number
    #[account(
        mut,
        del,
        seeds = [DECK_SEED, table.key().as_ref(), &table.hand_number.to_le_bytes()],
        bump
    )]
    pub deck_state: AccountInfo<'info>,
}

/// Delegate deck state to Ephemeral Rollup for private gameplay
/// This enables:
/// 1. Low-latency transactions (10ms instead of 400ms)
/// 2. Private shuffled deck (cards hidden until dealt/revealed)
pub fn handler(ctx: Context<DelegateDeck>) -> Result<()> {
    let table = &ctx.accounts.table;

    // Get optional validator from remaining accounts (for local testing)
    let validator = ctx.remaining_accounts.first().map(|acc| acc.key());

    // Delegate the deck state account to ER
    ctx.accounts.delegate_deck_state(
        &ctx.accounts.payer,
        &[
            DECK_SEED,
            table.key().as_ref(),
            &table.hand_number.to_le_bytes(),
        ],
        DelegateConfig {
            validator,
            ..Default::default()
        },
    )?;

    msg!(
        "Deck state for hand #{} delegated to Ephemeral Rollup",
        table.hand_number
    );
    Ok(())
}

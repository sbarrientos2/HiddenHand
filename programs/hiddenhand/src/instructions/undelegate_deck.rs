use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;

use crate::constants::*;
use crate::state::{DeckState, Table};

/// Undelegate the deck state from the Ephemeral Rollup
/// This commits the final state back to the base layer
/// Called after showdown or when ending a hand
#[commit]
#[derive(Accounts)]
pub struct UndelegateDeck<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [TABLE_SEED, table.table_id.as_ref()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,

    #[account(
        mut,
        seeds = [DECK_SEED, table.key().as_ref(), &table.hand_number.to_le_bytes()],
        bump = deck_state.bump
    )]
    pub deck_state: Account<'info, DeckState>,
}

/// Undelegate deck state from Ephemeral Rollup
/// Commits the current state to the base layer
pub fn handler(ctx: Context<UndelegateDeck>) -> Result<()> {
    let deck_state = &ctx.accounts.deck_state;

    // Commit and undelegate the deck state account
    commit_and_undelegate_accounts(
        &ctx.accounts.payer,
        vec![&deck_state.to_account_info()],
        &ctx.accounts.magic_context,
        &ctx.accounts.magic_program,
    )?;

    msg!(
        "Deck state undelegated from ER. Deal index: {}, Shuffled: {}",
        deck_state.deal_index,
        deck_state.is_shuffled
    );
    Ok(())
}

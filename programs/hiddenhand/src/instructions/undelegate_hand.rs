use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;

use crate::constants::*;
use crate::state::{HandState, Table};

/// Undelegate the hand state from the Ephemeral Rollup
/// This commits the final state (pot distribution, etc.) back to the base layer
/// Called after showdown or when ending a hand
#[commit]
#[derive(Accounts)]
pub struct UndelegateHand<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

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
}

/// Undelegate hand state from Ephemeral Rollup
/// Commits the current state (pot, phase, etc.) to the base layer
pub fn handler(ctx: Context<UndelegateHand>) -> Result<()> {
    let hand_state = &ctx.accounts.hand_state;

    // Commit and undelegate the hand state account
    commit_and_undelegate_accounts(
        &ctx.accounts.payer,
        vec![&hand_state.to_account_info()],
        &ctx.accounts.magic_context,
        &ctx.accounts.magic_program,
    )?;

    msg!(
        "Hand state #{} undelegated from ER. Phase: {:?}, Pot: {}",
        hand_state.hand_number,
        hand_state.phase,
        hand_state.pot
    );
    Ok(())
}

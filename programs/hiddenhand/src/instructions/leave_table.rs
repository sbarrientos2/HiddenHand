use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::state::{PlayerSeat, Table, TableStatus};

#[derive(Accounts)]
pub struct LeaveTable<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [TABLE_SEED, table.table_id.as_ref()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,

    #[account(
        mut,
        close = player,
        seeds = [SEAT_SEED, table.key().as_ref(), &[player_seat.seat_index]],
        bump = player_seat.bump,
        constraint = player_seat.player == player.key() @ HiddenHandError::PlayerNotAtTable
    )]
    pub player_seat: Account<'info, PlayerSeat>,

    /// Vault to withdraw from
    #[account(
        mut,
        seeds = [VAULT_SEED, table.key().as_ref()],
        bump
    )]
    /// CHECK: PDA vault validated by seeds
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<LeaveTable>) -> Result<()> {
    let table = &mut ctx.accounts.table;
    let player_seat = &ctx.accounts.player_seat;

    // Cannot leave during active hand
    require!(
        table.status != TableStatus::Playing,
        HiddenHandError::CannotLeaveDuringHand
    );

    let chips_to_return = player_seat.chips;
    let seat_index = player_seat.seat_index;
    let table_key = table.key();

    // Transfer chips back to player from vault using CPI with PDA signer
    if chips_to_return > 0 {
        let vault_bump = ctx.bumps.vault;
        let vault_seeds: &[&[u8]] = &[
            VAULT_SEED,
            table_key.as_ref(),
            &[vault_bump],
        ];

        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.player.to_account_info(),
                },
                &[vault_seeds],
            ),
            chips_to_return,
        )?;
    }

    // Update table
    table.vacate_seat(seat_index);

    msg!(
        "Player {} left table, returned {} chips",
        ctx.accounts.player.key(),
        chips_to_return
    );

    Ok(())
}

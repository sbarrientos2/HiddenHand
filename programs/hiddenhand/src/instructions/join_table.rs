use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::state::{PlayerSeat, PlayerStatus, Table, TableStatus};

#[derive(Accounts)]
#[instruction(seat_index: u8)]
pub struct JoinTable<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [TABLE_SEED, table.table_id.as_ref()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,

    #[account(
        init,
        payer = player,
        space = PlayerSeat::SIZE,
        seeds = [SEAT_SEED, table.key().as_ref(), &[seat_index]],
        bump
    )]
    pub player_seat: Account<'info, PlayerSeat>,

    /// Vault to receive buy-in
    #[account(
        mut,
        seeds = [VAULT_SEED, table.key().as_ref()],
        bump
    )]
    /// CHECK: PDA vault validated by seeds
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<JoinTable>, seat_index: u8, buy_in: u64) -> Result<()> {
    let table = &mut ctx.accounts.table;

    // Validate table state
    require!(
        table.status == TableStatus::Waiting,
        HiddenHandError::TableNotWaiting
    );

    require!(
        seat_index < table.max_players,
        HiddenHandError::InvalidSeatIndex
    );

    require!(
        !table.is_seat_occupied(seat_index),
        HiddenHandError::SeatOccupied
    );

    require!(
        table.current_players < table.max_players,
        HiddenHandError::TableFull
    );

    // Validate buy-in
    require!(
        buy_in >= table.min_buy_in && buy_in <= table.max_buy_in,
        HiddenHandError::InvalidBuyIn
    );

    // Transfer buy-in to vault
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.player.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        buy_in,
    )?;

    // Update table
    table.occupy_seat(seat_index);

    // Initialize player seat
    let player_seat = &mut ctx.accounts.player_seat;
    player_seat.table = table.key();
    player_seat.player = ctx.accounts.player.key();
    player_seat.seat_index = seat_index;
    player_seat.chips = buy_in;
    player_seat.current_bet = 0;
    player_seat.total_bet_this_hand = 0;
    player_seat.hole_card_1 = 0;
    player_seat.hole_card_2 = 0;
    player_seat.status = PlayerStatus::Sitting;
    player_seat.has_acted = false;
    player_seat.bump = ctx.bumps.player_seat;

    msg!(
        "Player {} joined table at seat {} with {} chips",
        ctx.accounts.player.key(),
        seat_index,
        buy_in
    );

    Ok(())
}

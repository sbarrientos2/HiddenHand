//! Close inactive table and return funds
//!
//! If a table has been inactive for TABLE_INACTIVE_TIMEOUT_SECONDS (1 hour),
//! anyone can call this instruction to close it and return all deposited SOL
//! to the players.
//!
//! Requirements:
//! - Table must be in Waiting status (not mid-hand)
//! - Table must be inactive for the timeout period
//!
//! This prevents SOL from being stuck in abandoned tables.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::state::{PlayerSeat, Table, TableStatus};

#[derive(Accounts)]
pub struct CloseInactiveTable<'info> {
    /// Anyone can call this after timeout
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [TABLE_SEED, table.table_id.as_ref()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,

    /// The vault holding player funds
    /// CHECK: PDA verified by seeds
    #[account(
        mut,
        seeds = [VAULT_SEED, table.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// Close an inactive table and return funds to all players
/// remaining_accounts should contain all player seats and their corresponding wallet accounts
/// Format: [seat0, wallet0, seat1, wallet1, ...]
pub fn handler(ctx: Context<CloseInactiveTable>) -> Result<()> {
    let table = &mut ctx.accounts.table;
    let vault = &ctx.accounts.vault;
    let clock = Clock::get()?;

    // Validate table is in Waiting status (not mid-hand)
    require!(
        table.status == TableStatus::Waiting,
        HiddenHandError::HandInProgress
    );

    // Check timeout - must be inactive for TABLE_INACTIVE_TIMEOUT_SECONDS
    let elapsed = clock.unix_timestamp - table.last_ready_time;
    require!(
        elapsed >= TABLE_INACTIVE_TIMEOUT_SECONDS,
        HiddenHandError::TimeoutNotReached
    );

    msg!(
        "Closing inactive table after {} seconds of inactivity",
        elapsed
    );

    // Process remaining_accounts in pairs: [seat, wallet, seat, wallet, ...]
    let remaining = ctx.remaining_accounts;
    require!(
        remaining.len() % 2 == 0,
        HiddenHandError::InvalidRemainingAccounts
    );

    let table_key = table.key();
    let _vault_seeds: &[&[u8]] = &[VAULT_SEED, table_key.as_ref(), &[ctx.bumps.vault]];
    let program_id = crate::ID;

    let mut total_returned: u64 = 0;

    for chunk in remaining.chunks(2) {
        let seat_info = &chunk[0];
        let wallet_info = &chunk[1];

        // Security check 1: Verify seat account is owned by our program
        if seat_info.owner != &program_id {
            continue;
        }

        // Deserialize the seat
        let seat_data = seat_info.try_borrow_data()?;
        if seat_data.len() >= 8 {
            // Check discriminator and deserialize
            let seat = PlayerSeat::try_deserialize(&mut &seat_data[..])?;

            // Security check 2: Verify seat belongs to this table
            if seat.table != table_key {
                drop(seat_data);
                continue;
            }

            // Security check 3: Verify PDA derivation
            let (expected_pda, _) = Pubkey::find_program_address(
                &[SEAT_SEED, table_key.as_ref(), &[seat.seat_index]],
                &program_id,
            );
            if *seat_info.key != expected_pda {
                drop(seat_data);
                continue;
            }

            // Verify wallet matches seat player
            if seat.player != *wallet_info.key {
                msg!(
                    "Warning: Wallet mismatch for seat {}. Expected {}, got {}",
                    seat.seat_index,
                    seat.player,
                    wallet_info.key
                );
                drop(seat_data);
                continue;
            }

            // Return chips to player
            if seat.chips > 0 {
                let transfer_amount = seat.chips;

                // Transfer from vault to player wallet
                **vault.try_borrow_mut_lamports()? -= transfer_amount;
                **wallet_info.try_borrow_mut_lamports()? += transfer_amount;

                total_returned += transfer_amount;

                msg!(
                    "Returned {} lamports to player {} from seat {}",
                    transfer_amount,
                    seat.player,
                    seat.seat_index
                );
            }
        }
        drop(seat_data);

        // Clear the seat (re-validate ownership and PDA)
        if seat_info.owner != &program_id {
            continue;
        }
        let mut seat_data = seat_info.try_borrow_mut_data()?;
        if seat_data.len() >= 8 {
            let mut seat = PlayerSeat::try_deserialize(&mut &seat_data[..])?;
            if seat.table == table_key {
                let (expected_pda, _) = Pubkey::find_program_address(
                    &[SEAT_SEED, table_key.as_ref(), &[seat.seat_index]],
                    &program_id,
                );
                if *seat_info.key == expected_pda {
                    seat.chips = 0;
                    seat.player = Pubkey::default();
                    seat.try_serialize(&mut *seat_data)?;
                }
            }
        }
    }

    // Mark table as closed
    table.status = TableStatus::Closed;
    table.current_players = 0;
    table.occupied_seats = 0;

    msg!(
        "Table closed. Total {} lamports returned to players.",
        total_returned
    );

    Ok(())
}
